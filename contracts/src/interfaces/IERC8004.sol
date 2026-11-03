// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Subset of the ERC-8004 reference registries (github.com/erc-8004/erc-8004-contracts).
/// Injective testnet: Identity 0x8004A818BFB912233c491871b3d84c89A494BD9e,
///                    Reputation 0x8004B663056A597Dffe9eCcC1965A193B7388713
interface IIdentityRegistry {
    struct MetadataEntry {
        string metadataKey;
        bytes metadataValue;
    }

    function register(string memory agentURI, MetadataEntry[] memory metadata) external returns (uint256 agentId);
    function setMetadata(uint256 agentId, string memory metadataKey, bytes memory metadataValue) external;
    function getMetadata(uint256 agentId, string memory metadataKey) external view returns (bytes memory);
    function ownerOf(uint256 tokenId) external view returns (address);
    function isAuthorizedOrOwner(address spender, uint256 agentId) external view returns (bool);
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
    function tokenURI(uint256 tokenId) external view returns (string memory);
}

interface IReputationRegistry {
    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external;

    function getLastIndex(uint256 agentId, address clientAddress) external view returns (uint64);
}
