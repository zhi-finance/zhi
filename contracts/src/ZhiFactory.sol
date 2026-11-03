// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

import {GuardrailVault} from "./GuardrailVault.sol";
import {ZhiTypes} from "./ZhiTypes.sol";
import {IIdentityRegistry} from "./interfaces/IERC8004.sol";

/// @title ZhiFactory
/// @notice One call creates a Zhi agent: a Guardrail Vault clone plus an ERC-8004 identity whose
///         metadata names the vault as fee recipient. The identity NFT is handed to the operator.
contract ZhiFactory is Ownable, IERC721Receiver {
    struct CreateParams {
        address harness;
        ZhiTypes.Bounds bounds;
        ZhiTypes.MarketInput[] markets;
        string agentURI; // IPFS / https agent card
    }

    struct AgentInfo {
        address vault;
        address operator;
        uint256 agentId;
        uint64 createdAt;
    }

    address public immutable vaultImplementation;
    IIdentityRegistry public identity;
    address public asset;
    string public denom;
    address public treasury;
    uint16 public protocolFeeShareBps;

    AgentInfo[] internal _agents;
    mapping(address => bool) public isVault;
    mapping(uint256 => address) public vaultOfAgent;
    mapping(address => address[]) internal _vaultsOf;

    event AgentCreated(
        address indexed vault, address indexed operator, uint256 indexed agentId, address harness, string feeRecipient
    );
    event ConfigUpdated(address identity, address treasury, uint16 protocolFeeShareBps);

    constructor(
        address owner_,
        address identity_,
        address asset_,
        string memory denom_,
        address treasury_,
        uint16 protocolFeeShareBps_
    ) Ownable(owner_) {
        vaultImplementation = address(new GuardrailVault());
        identity = IIdentityRegistry(identity_);
        asset = asset_;
        denom = denom_;
        treasury = treasury_;
        protocolFeeShareBps = protocolFeeShareBps_;
    }

    function createAgent(CreateParams calldata p) external returns (address vault, uint256 agentId) {
        vault = Clones.clone(vaultImplementation);
        GuardrailVault(vault).initialize(
            GuardrailVault.InitParams({
                owner: msg.sender,
                harness: p.harness,
                asset: asset,
                denom: denom,
                treasury: treasury,
                protocolFeeShareBps: protocolFeeShareBps,
                bounds: p.bounds,
                markets: p.markets
            })
        );
        string memory feeRecipient = GuardrailVault(vault).feeRecipient();

        if (address(identity) != address(0)) {
            IIdentityRegistry.MetadataEntry[] memory md = new IIdentityRegistry.MetadataEntry[](4);
            md[0] = IIdentityRegistry.MetadataEntry("agentType", bytes("zhi.trading.v1"));
            md[1] = IIdentityRegistry.MetadataEntry("feeRecipient", bytes(feeRecipient));
            md[2] = IIdentityRegistry.MetadataEntry("zhi.vault", abi.encodePacked(vault));
            md[3] = IIdentityRegistry.MetadataEntry("zhi.harness", abi.encodePacked(p.harness));
            agentId = identity.register(p.agentURI, md);
            identity.safeTransferFrom(address(this), msg.sender, agentId);
            GuardrailVault(vault).setAgentId(agentId);
            vaultOfAgent[agentId] = vault;
        }

        isVault[vault] = true;
        _agents.push(AgentInfo(vault, msg.sender, agentId, uint64(block.timestamp)));
        _vaultsOf[msg.sender].push(vault);
        emit AgentCreated(vault, msg.sender, agentId, p.harness, feeRecipient);
    }

    function setConfig(address identity_, address treasury_, uint16 feeShareBps_) external onlyOwner {
        require(feeShareBps_ <= 5000, "fee");
        identity = IIdentityRegistry(identity_);
        treasury = treasury_;
        protocolFeeShareBps = feeShareBps_;
        emit ConfigUpdated(identity_, treasury_, feeShareBps_);
    }

    function agentCount() external view returns (uint256) {
        return _agents.length;
    }

    function agentAt(uint256 i) external view returns (AgentInfo memory) {
        return _agents[i];
    }

    /// Paged listing for the leaderboard.
    function agents(uint256 offset, uint256 limit) external view returns (AgentInfo[] memory out) {
        uint256 n = _agents.length;
        if (offset >= n) return new AgentInfo[](0);
        uint256 end = offset + limit > n ? n : offset + limit;
        out = new AgentInfo[](end - offset);
        for (uint256 i = offset; i < end; i++) out[i - offset] = _agents[i];
    }

    function vaultsOf(address operator) external view returns (address[] memory) {
        return _vaultsOf[operator];
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}
