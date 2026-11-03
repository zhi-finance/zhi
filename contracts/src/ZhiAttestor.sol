// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IReputationRegistry} from "./interfaces/IERC8004.sol";

/// @title ZhiAttestor
/// @notice Posts each agent's daily, hash-linked epoch report to the ERC-8004 Reputation Registry.
///         The reference registry rejects feedback from an agent's owner or operators, so feedback
///         comes from this contract, never from the operator. Scores only become usable by the
///         capital layer after a 72h challenge window in which anyone can dispute them.
contract ZhiAttestor is Ownable {
    uint256 public constant CHALLENGE_WINDOW = 72 hours;
    string public constant ENDPOINT = "zhi.attestor.v1";

    struct EpochReport {
        int128 pnlBps;
        uint128 maxDdBps;
        uint128 adherenceX1e4;
        uint16 score;
        uint32 daysLive;
        uint32 closedTrades;
        bytes32 reportHash;
        uint64 postedAt;
    }

    struct ScoreState {
        uint64 pendingEpoch; //   epoch of the score waiting out its challenge window
        uint64 lastEpoch; //      last epoch posted
        bool challenged;
        uint16 finalScore; //     usable by the allocator / credit layer
        uint32 finalDaysLive;
        uint32 finalClosedTrades;
        uint64 finalEpoch;
    }

    IReputationRegistry public reputation;
    mapping(address => bool) public attester;
    mapping(uint256 => mapping(uint64 => EpochReport)) public reports;
    mapping(uint256 => ScoreState) public scoreState;

    event AttesterSet(address indexed attester, bool allowed);
    event EpochPosted(
        uint256 indexed agentId, uint64 indexed epoch, uint16 score, bytes32 reportHash, string reportURI
    );
    event ScoreChallenged(uint256 indexed agentId, uint64 indexed epoch, address challenger, uint16 claimedScore, string evidenceURI);
    event ChallengeResolved(uint256 indexed agentId, uint64 indexed epoch, bool upheld, uint16 score);
    event ScoreFinalized(uint256 indexed agentId, uint64 indexed epoch, uint16 score);

    constructor(address owner_, address reputation_) Ownable(owner_) {
        reputation = IReputationRegistry(reputation_);
    }

    modifier onlyAttester() {
        require(attester[msg.sender], "not attester");
        _;
    }

    function setAttester(address a, bool allowed) external onlyOwner {
        attester[a] = allowed;
        emit AttesterSet(a, allowed);
    }

    function setReputation(address r) external onlyOwner {
        reputation = IReputationRegistry(r);
    }

    /// @notice Post one epoch for one agent. `reportURI` points to the full report (every
    ///         ExecutionLogged / TradeSkipped / Frozen event plus the harness log root);
    ///         `reportHash` is its keccak256.
    function postEpoch(
        uint256 agentId,
        uint64 epoch,
        EpochReport calldata r,
        string calldata reportURI
    ) external onlyAttester {
        ScoreState storage s = scoreState[agentId];
        require(epoch > s.lastEpoch, "epoch order");
        require(r.score >= 300 && r.score <= 850, "score range");

        _maybeFinalize(agentId);

        EpochReport storage stored = reports[agentId][epoch];
        stored.pnlBps = r.pnlBps;
        stored.maxDdBps = r.maxDdBps;
        stored.adherenceX1e4 = r.adherenceX1e4;
        stored.score = r.score;
        stored.daysLive = r.daysLive;
        stored.closedTrades = r.closedTrades;
        stored.reportHash = r.reportHash;
        stored.postedAt = uint64(block.timestamp);

        s.lastEpoch = epoch;
        // One score at a time waits out its window. Daily posts must not keep restarting it, so a new
        // epoch only becomes pending once the previous pending score has been finalized.
        if (s.pendingEpoch == 0 || (s.pendingEpoch <= s.finalEpoch && !s.challenged)) {
            s.pendingEpoch = epoch;
        }

        if (address(reputation) != address(0)) {
            reputation.giveFeedback(agentId, r.pnlBps, 0, "zhi.epoch", "pnl_bps", ENDPOINT, reportURI, r.reportHash);
            reputation.giveFeedback(
                agentId, int128(r.maxDdBps), 0, "zhi.epoch", "max_dd_bps", ENDPOINT, reportURI, r.reportHash
            );
            reputation.giveFeedback(
                agentId, int128(r.adherenceX1e4), 4, "zhi.epoch", "adherence", ENDPOINT, reportURI, r.reportHash
            );
            reputation.giveFeedback(
                agentId, int128(uint128(r.score)), 0, "zhi.score", "v1", ENDPOINT, reportURI, r.reportHash
            );
        }
        emit EpochPosted(agentId, epoch, r.score, r.reportHash, reportURI);
    }

    /// @notice Anyone may dispute a pending score inside the window by publishing a recomputation.
    function challenge(uint256 agentId, uint16 claimedScore, string calldata evidenceURI) external {
        ScoreState storage s = scoreState[agentId];
        require(s.pendingEpoch != 0, "nothing pending");
        EpochReport storage r = reports[agentId][s.pendingEpoch];
        require(block.timestamp < r.postedAt + CHALLENGE_WINDOW, "window closed");
        require(claimedScore != r.score, "same score");
        s.challenged = true;
        emit ScoreChallenged(agentId, s.pendingEpoch, msg.sender, claimedScore, evidenceURI);
    }

    /// @notice Owner (protocol multisig) resolves a dispute. Upheld => corrected score is final.
    function resolveChallenge(uint256 agentId, bool upheld, uint16 correctedScore) external onlyOwner {
        ScoreState storage s = scoreState[agentId];
        require(s.challenged, "not challenged");
        uint64 epoch = s.pendingEpoch;
        EpochReport storage r = reports[agentId][epoch];
        uint16 score = upheld ? correctedScore : r.score;
        require(score >= 300 && score <= 850, "score range");
        r.score = score;
        s.challenged = false;
        _finalize(agentId, epoch);
        emit ChallengeResolved(agentId, epoch, upheld, score);
    }

    function finalize(uint256 agentId) external {
        require(_maybeFinalize(agentId), "not finalizable");
    }

    function scoreOf(uint256 agentId) external view returns (uint16 score, uint32 daysLive, uint32 closedTrades) {
        ScoreState storage s = scoreState[agentId];
        // a pending score whose window passed unchallenged is final even before finalize() is called
        if (s.pendingEpoch != 0 && !s.challenged) {
            EpochReport storage r = reports[agentId][s.pendingEpoch];
            if (block.timestamp >= r.postedAt + CHALLENGE_WINDOW && s.pendingEpoch > s.finalEpoch) {
                return (r.score, r.daysLive, r.closedTrades);
            }
        }
        return (s.finalScore, s.finalDaysLive, s.finalClosedTrades);
    }

    function _maybeFinalize(uint256 agentId) internal returns (bool) {
        ScoreState storage s = scoreState[agentId];
        if (s.pendingEpoch == 0 || s.challenged || s.pendingEpoch <= s.finalEpoch) return false;
        EpochReport storage r = reports[agentId][s.pendingEpoch];
        if (block.timestamp < r.postedAt + CHALLENGE_WINDOW) return false;
        _finalize(agentId, s.pendingEpoch);
        return true;
    }

    function _finalize(uint256 agentId, uint64 epoch) internal {
        ScoreState storage s = scoreState[agentId];
        EpochReport storage r = reports[agentId][epoch];
        s.finalScore = r.score;
        s.finalDaysLive = r.daysLive;
        s.finalClosedTrades = r.closedTrades;
        s.finalEpoch = epoch;
        emit ScoreFinalized(agentId, epoch, r.score);
    }
}
