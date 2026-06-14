// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {AlephEscrow} from "../src/AlephEscrow.sol";
import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

/// A malicious ERC-20 that, on transfer to the payee, calls back into the
/// escrow trying to release/refund the same escrow again (a reentrancy attack).
contract ReentrantToken is ERC20 {
    AlephEscrow public escrow;
    bytes32 public targetId;
    bool public attacking;

    constructor() ERC20("Reentrant", "RE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(AlephEscrow _escrow, bytes32 _id) external {
        escrow = _escrow;
        targetId = _id;
        attacking = true;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        // On the escrow paying out (transfer FROM the escrow), try to reenter.
        if (attacking && from == address(escrow)) {
            attacking = false; // only attempt once
            // This call must revert due to ReentrancyGuard; we swallow it so the
            // outer transfer can complete and the test asserts no double-pay.
            try escrow.release(targetId) {} catch {}
            try escrow.refund(targetId) {} catch {}
        }
    }
}

contract ReentrancyTest is Test {
    AlephEscrow escrow;
    ReentrantToken token;
    address payer = address(0xA11CE);
    address payee = address(0xB0B);
    bytes32 constant ID = keccak256("re-1");

    function setUp() public {
        token = new ReentrantToken();
        escrow = new AlephEscrow(IERC20(address(token)));
        token.mint(payer, 1000);
        vm.prank(payer);
        token.approve(address(escrow), type(uint256).max);
    }

    function test_reentrancyDoesNotDoublePay() public {
        vm.prank(payer);
        escrow.lock(ID, payee, 100, keccak256("ref"), uint64(block.timestamp + 1 hours));
        token.arm(escrow, ID);

        vm.prank(payer);
        escrow.release(ID);

        // The reentrant release/refund were blocked by the guard: the payee was
        // paid exactly once, and the escrow holds nothing extra.
        assertEq(token.balanceOf(payee), 100);
        assertEq(token.balanceOf(address(escrow)), 0);
        assertEq(uint8(escrow.getEscrow(ID).status), uint8(AlephEscrow.Status.Released));
    }
}
