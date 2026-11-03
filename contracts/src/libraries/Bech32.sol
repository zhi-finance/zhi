// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Bech32
/// @notice Minimal BIP-173 bech32 encoder for 20-byte account addresses.
/// @dev Used so a Guardrail Vault can derive its own `inj1...` address on-chain and set
///      itself as the exchange `feeRecipient` on every order, without trusting an
///      off-chain conversion supplied by the operator.
library Bech32 {
    bytes private constant CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

    function encodeAddress(string memory hrp, address account) internal pure returns (string memory) {
        bytes memory h = bytes(hrp);
        bytes20 raw = bytes20(account);

        // 8-bit -> 5-bit regrouping. 160 bits / 5 = 32 groups exactly, so no padding.
        uint8[] memory data = new uint8[](32);
        uint256 acc;
        uint256 bits;
        uint256 idx;
        for (uint256 i = 0; i < 20; i++) {
            acc = ((acc << 8) | uint8(raw[i])) & 0x1fff; // keep at most 13 bits
            bits += 8;
            while (bits >= 5) {
                bits -= 5;
                data[idx++] = uint8((acc >> bits) & 31);
            }
        }

        // values = hrpExpand(hrp) ++ data ++ [0;6]
        uint256 n = h.length * 2 + 1 + 32 + 6;
        uint8[] memory values = new uint8[](n);
        uint256 k;
        for (uint256 i = 0; i < h.length; i++) values[k++] = uint8(h[i]) >> 5;
        values[k++] = 0;
        for (uint256 i = 0; i < h.length; i++) values[k++] = uint8(h[i]) & 31;
        for (uint256 i = 0; i < 32; i++) values[k++] = data[i];
        // remaining six entries are already zero

        uint32 mod = _polymod(values) ^ 1;

        bytes memory out = new bytes(h.length + 1 + 32 + 6);
        uint256 o;
        for (uint256 i = 0; i < h.length; i++) out[o++] = h[i];
        out[o++] = "1";
        for (uint256 i = 0; i < 32; i++) out[o++] = CHARSET[data[i]];
        for (uint256 i = 0; i < 6; i++) out[o++] = CHARSET[(mod >> (5 * (5 - i))) & 31];
        return string(out);
    }

    function _polymod(uint8[] memory values) private pure returns (uint32 chk) {
        uint32[5] memory gen = [uint32(0x3b6a57b2), 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
        chk = 1;
        for (uint256 p = 0; p < values.length; p++) {
            uint32 top = chk >> 25;
            chk = ((chk & 0x1ffffff) << 5) ^ uint32(values[p]);
            for (uint256 i = 0; i < 5; i++) {
                if ((top >> i) & 1 == 1) chk ^= gen[i];
            }
        }
    }
}
