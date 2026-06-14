// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";

/// @title AlephEscrow
/// @notice Per-invocation escrow for the Aleph PAY verb. A payer locks a
///         stablecoin amount for a specific invocation; on delivery the payer
///         releases it to the payee; if the node never delivers, the deadline
///         lets the funds be refunded. This is what makes settlement trustless,
///         and what makes settlement-backed reputation real.
/// @dev    Immutable (no proxy/upgradeability) to keep the audited surface
///         minimal. Reentrancy-guarded with checks-effects-interactions
///         ordering; SafeERC20 for non-standard tokens.
contract AlephEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice The settlement token (a stablecoin, e.g. USDC).
    IERC20 public immutable token;

    enum Status {
        None,
        Locked,
        Released,
        Refunded
    }

    struct Escrow {
        address payer;
        address payee;
        uint256 amount;
        bytes32 invokeRef; // hash of the INVOKE envelope this pays for
        uint64 deadline; // after this, the payer may be refunded
        Status status;
    }

    /// @notice Escrows by id (id is chosen by the caller; collisions revert).
    mapping(bytes32 id => Escrow) public escrows;

    event Locked(
        bytes32 indexed id,
        address indexed payer,
        address indexed payee,
        uint256 amount,
        bytes32 invokeRef,
        uint64 deadline
    );
    event Released(bytes32 indexed id, address indexed payee, uint256 amount);
    event Refunded(bytes32 indexed id, address indexed payer, uint256 amount);

    error EscrowExists();
    error NotLocked();
    error NotPayer();
    error NotParty();
    error TooEarly();
    error ZeroAmount();

    constructor(IERC20 _token) {
        token = _token;
    }

    /// @notice Lock `amount` for an invocation. Pulls the tokens from the caller
    ///         (who must have approved this contract). The caller is the payer.
    function lock(bytes32 id, address payee, uint256 amount, bytes32 invokeRef, uint64 deadline)
        external
        nonReentrant
    {
        if (escrows[id].status != Status.None) revert EscrowExists();
        if (amount == 0) revert ZeroAmount();
        // effects before interaction
        escrows[id] = Escrow({
            payer: msg.sender,
            payee: payee,
            amount: amount,
            invokeRef: invokeRef,
            deadline: deadline,
            status: Status.Locked
        });
        // interaction
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit Locked(id, msg.sender, payee, amount, invokeRef, deadline);
    }

    /// @notice Release the escrow to the payee. Authorized by the payer
    ///         (acknowledging delivery). Atomic with the off-chain RECEIPT.
    function release(bytes32 id) external nonReentrant {
        Escrow storage e = escrows[id];
        if (e.status != Status.Locked) revert NotLocked();
        if (msg.sender != e.payer) revert NotPayer();
        e.status = Status.Released; // effects
        token.safeTransfer(e.payee, e.amount); // interaction
        emit Released(id, e.payee, e.amount);
    }

    /// @notice Refund the escrow to the payer. Allowed after the deadline (a
    ///         node that never delivered), or immediately if the payee declines
    ///         (returns the funds themselves).
    function refund(bytes32 id) external nonReentrant {
        Escrow storage e = escrows[id];
        if (e.status != Status.Locked) revert NotLocked();
        bool afterDeadline = block.timestamp >= e.deadline;
        bool byPayee = msg.sender == e.payee;
        if (!afterDeadline && !byPayee) revert TooEarly();
        if (msg.sender != e.payer && msg.sender != e.payee) revert NotParty();
        e.status = Status.Refunded; // effects
        token.safeTransfer(e.payer, e.amount); // interaction
        emit Refunded(id, e.payer, e.amount);
    }

    /// @notice Read an escrow (for off-chain verification of a SettlementRecord).
    function getEscrow(bytes32 id) external view returns (Escrow memory) {
        return escrows[id];
    }
}
