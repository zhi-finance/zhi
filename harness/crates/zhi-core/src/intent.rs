//! Intents: the only thing the harness can hand the vault.
//! `{ruleTreeHash, marketId, isBuy, reduceOnly, quantity, worstPrice, margin, tpPrice, slPrice,
//!   synthHash, nonce, deadline}` — ABI-identical to `ZhiTypes.Intent` in Solidity.

use crate::canonical::keccak256;
use crate::fixed::Fx;
use alloy_primitives::{B256, U256};
use alloy_sol_types::{sol, SolValue};
use serde::{Deserialize, Serialize};

sol! {
    #[derive(Debug, PartialEq, Eq)]
    struct SolIntent {
        bytes32 ruleTreeHash;
        bytes32 marketId;
        bool isBuy;
        bool reduceOnly;
        uint256 quantity;
        uint256 worstPrice;
        uint256 margin;
        uint256 tpPrice;
        uint256 slPrice;
        bytes32 synthHash;
        uint64 nonce;
        uint64 deadline;
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Intent {
    pub rule_tree_hash: String,
    pub market_id: String,
    pub is_buy: bool,
    pub reduce_only: bool,
    pub quantity: Fx,
    pub worst_price: Fx,
    pub margin: Fx,
    pub tp_price: Fx,
    pub sl_price: Fx,
    pub synth_hash: String,
    pub nonce: u64,
    pub deadline: u64,
}

fn b256(h: &str) -> B256 {
    h.parse().unwrap_or(B256::ZERO)
}

fn u(v: Fx) -> U256 {
    U256::from(v.to_u256_raw())
}

impl Intent {
    pub fn to_sol(&self) -> SolIntent {
        SolIntent {
            ruleTreeHash: b256(&self.rule_tree_hash),
            marketId: b256(&self.market_id),
            isBuy: self.is_buy,
            reduceOnly: self.reduce_only,
            quantity: u(self.quantity),
            worstPrice: u(self.worst_price),
            margin: u(self.margin),
            tpPrice: u(self.tp_price),
            slPrice: u(self.sl_price),
            synthHash: b256(&self.synth_hash),
            nonce: self.nonce,
            deadline: self.deadline,
        }
    }

    /// keccak256(abi.encode(intent)) — equals the `intentHash` the vault emits.
    pub fn hash(&self) -> String {
        format!("0x{}", hex::encode(keccak256(&self.to_sol().abi_encode())))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Cross-checked with:
    /// cast keccak $(cast abi-encode "f((bytes32,bytes32,bool,bool,uint256,uint256,uint256,uint256,uint256,bytes32,uint64,uint64))" \
    ///   "(0x11..11,0xfd70..1515,true,false,100000000000000000,75100000000000000000000,2000000000000000000000,0,0,0x22..22,7,1800000060)")
    #[test]
    fn abi_hash_matches_solidity_encoding() {
        let it = Intent {
            rule_tree_hash: format!("0x{}", "11".repeat(32)),
            market_id: "0xfd704649cf3a516c0c145ab0111717c44640d8dbe52a462ae35cadf2f6df1515".into(),
            is_buy: true,
            reduce_only: false,
            quantity: "0.1".parse().unwrap(),
            worst_price: "75100".parse().unwrap(),
            margin: "2000".parse().unwrap(),
            tp_price: Fx::ZERO,
            sl_price: Fx::ZERO,
            synth_hash: format!("0x{}", "22".repeat(32)),
            nonce: 7,
            deadline: 1_800_000_060,
        };
        // static struct: 12 words
        assert_eq!(it.to_sol().abi_encode().len(), 12 * 32);
        assert_eq!(it.hash(), include_str!("../../../../fixtures/intent.example.hash").trim());
    }
}
