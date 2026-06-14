// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {AlephEscrow} from "../src/AlephEscrow.sol";
import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USD", "mUSDC") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract AlephEscrowTest is Test {
    AlephEscrow escrow;
    MockUSDC usdc;

    address payer = address(0xA11CE);
    address payee = address(0xB0B);

    bytes32 constant ID = keccak256("escrow-1");
    bytes32 constant INVOKE_REF = keccak256("invoke-1");
    uint256 constant AMOUNT = 100e6; // 100 USDC (6 decimals)

    function setUp() public {
        usdc = new MockUSDC();
        escrow = new AlephEscrow(IERC20(address(usdc)));
        usdc.mint(payer, 1_000e6);
        vm.prank(payer);
        usdc.approve(address(escrow), type(uint256).max);
    }

    function _lock(uint64 deadline) internal {
        vm.prank(payer);
        escrow.lock(ID, payee, AMOUNT, INVOKE_REF, deadline);
    }

    // --- happy paths ---

    function test_lock_pullsFundsAndRecordsEscrow() public {
        _lock(uint64(block.timestamp + 1 hours));
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT);
        AlephEscrow.Escrow memory e = escrow.getEscrow(ID);
        assertEq(e.payer, payer);
        assertEq(e.payee, payee);
        assertEq(e.amount, AMOUNT);
        assertEq(uint8(e.status), uint8(AlephEscrow.Status.Locked));
    }

    function test_release_paysPayee() public {
        _lock(uint64(block.timestamp + 1 hours));
        vm.prank(payer);
        escrow.release(ID);
        assertEq(usdc.balanceOf(payee), AMOUNT);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(uint8(escrow.getEscrow(ID).status), uint8(AlephEscrow.Status.Released));
    }

    function test_refund_afterDeadline_returnsToPayer() public {
        _lock(uint64(block.timestamp + 1 hours));
        uint256 before = usdc.balanceOf(payer);
        vm.warp(block.timestamp + 2 hours); // past deadline
        vm.prank(payer);
        escrow.refund(ID);
        assertEq(usdc.balanceOf(payer), before + AMOUNT);
        assertEq(uint8(escrow.getEscrow(ID).status), uint8(AlephEscrow.Status.Refunded));
    }

    function test_refund_byPayee_isAllowedEarly() public {
        _lock(uint64(block.timestamp + 1 hours));
        uint256 before = usdc.balanceOf(payer);
        vm.prank(payee); // payee declines and returns the funds before the deadline
        escrow.refund(ID);
        assertEq(usdc.balanceOf(payer), before + AMOUNT);
    }

    // --- guards / reverts ---

    function test_lock_revertsOnDuplicateId() public {
        _lock(uint64(block.timestamp + 1 hours));
        vm.prank(payer);
        vm.expectRevert(AlephEscrow.EscrowExists.selector);
        escrow.lock(ID, payee, AMOUNT, INVOKE_REF, uint64(block.timestamp + 1 hours));
    }

    function test_lock_revertsOnZeroAmount() public {
        vm.prank(payer);
        vm.expectRevert(AlephEscrow.ZeroAmount.selector);
        escrow.lock(ID, payee, 0, INVOKE_REF, uint64(block.timestamp + 1 hours));
    }

    function test_release_revertsForNonPayer() public {
        _lock(uint64(block.timestamp + 1 hours));
        vm.prank(payee);
        vm.expectRevert(AlephEscrow.NotPayer.selector);
        escrow.release(ID);
    }

    function test_cannotReleaseTwice() public {
        _lock(uint64(block.timestamp + 1 hours));
        vm.startPrank(payer);
        escrow.release(ID);
        vm.expectRevert(AlephEscrow.NotLocked.selector);
        escrow.release(ID);
        vm.stopPrank();
    }

    function test_cannotReleaseAfterRefund() public {
        _lock(uint64(block.timestamp + 1 hours));
        vm.warp(block.timestamp + 2 hours);
        vm.prank(payer);
        escrow.refund(ID);
        vm.prank(payer);
        vm.expectRevert(AlephEscrow.NotLocked.selector);
        escrow.release(ID);
    }

    function test_refund_revertsTooEarlyForPayer() public {
        _lock(uint64(block.timestamp + 1 hours));
        vm.prank(payer);
        vm.expectRevert(AlephEscrow.TooEarly.selector);
        escrow.refund(ID);
    }

    function test_refund_revertsForStranger() public {
        _lock(uint64(block.timestamp + 1 hours));
        vm.warp(block.timestamp + 2 hours);
        vm.prank(address(0xDEAD));
        vm.expectRevert(AlephEscrow.NotParty.selector);
        escrow.refund(ID);
    }

    function test_release_revertsOnUnknownEscrow() public {
        vm.prank(payer);
        vm.expectRevert(AlephEscrow.NotLocked.selector);
        escrow.release(keccak256("nope"));
    }

    // --- fuzz ---

    function testFuzz_lockReleaseConservesValue(uint96 amount) public {
        amount = uint96(bound(amount, 1, 1_000e6));
        usdc.mint(payer, amount);
        bytes32 id = keccak256(abi.encode("fuzz", amount));
        vm.prank(payer);
        escrow.lock(id, payee, amount, INVOKE_REF, uint64(block.timestamp + 1 hours));
        uint256 payeeBefore = usdc.balanceOf(payee);
        vm.prank(payer);
        escrow.release(id);
        assertEq(usdc.balanceOf(payee), payeeBefore + amount);
    }
}
