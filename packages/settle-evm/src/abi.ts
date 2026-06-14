// Generated from contracts/out/AlephEscrow.sol/AlephEscrow.json (forge build).
// The ABI + creation bytecode for deploying and calling AlephEscrow.
// Regenerate with: pnpm --filter @aleph/settle-evm gen:abi

export const alephEscrowAbi = [
  {
    type: "constructor",
    inputs: [
      {
        name: "_token",
        type: "address",
        internalType: "contract IERC20",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "escrows",
    inputs: [
      {
        name: "id",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "payer",
        type: "address",
        internalType: "address",
      },
      {
        name: "payee",
        type: "address",
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "invokeRef",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "deadline",
        type: "uint64",
        internalType: "uint64",
      },
      {
        name: "status",
        type: "uint8",
        internalType: "enum AlephEscrow.Status",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getEscrow",
    inputs: [
      {
        name: "id",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct AlephEscrow.Escrow",
        components: [
          {
            name: "payer",
            type: "address",
            internalType: "address",
          },
          {
            name: "payee",
            type: "address",
            internalType: "address",
          },
          {
            name: "amount",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "invokeRef",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "deadline",
            type: "uint64",
            internalType: "uint64",
          },
          {
            name: "status",
            type: "uint8",
            internalType: "enum AlephEscrow.Status",
          },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "lock",
    inputs: [
      {
        name: "id",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "payee",
        type: "address",
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "invokeRef",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "deadline",
        type: "uint64",
        internalType: "uint64",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "refund",
    inputs: [
      {
        name: "id",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "release",
    inputs: [
      {
        name: "id",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "token",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract IERC20",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "Locked",
    inputs: [
      {
        name: "id",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "payer",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "payee",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "invokeRef",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
      {
        name: "deadline",
        type: "uint64",
        indexed: false,
        internalType: "uint64",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Refunded",
    inputs: [
      {
        name: "id",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "payer",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Released",
    inputs: [
      {
        name: "id",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "payee",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "error",
    name: "EscrowExists",
    inputs: [],
  },
  {
    type: "error",
    name: "NotLocked",
    inputs: [],
  },
  {
    type: "error",
    name: "NotParty",
    inputs: [],
  },
  {
    type: "error",
    name: "NotPayer",
    inputs: [],
  },
  {
    type: "error",
    name: "ReentrancyGuardReentrantCall",
    inputs: [],
  },
  {
    type: "error",
    name: "SafeERC20FailedOperation",
    inputs: [
      {
        name: "token",
        type: "address",
        internalType: "address",
      },
    ],
  },
  {
    type: "error",
    name: "TooEarly",
    inputs: [],
  },
  {
    type: "error",
    name: "ZeroAmount",
    inputs: [],
  },
] as const;

export const alephEscrowBytecode =
  "0x60a060405234801561000f575f5ffd5b50604051610a95380380610a9583398101604081905261002e91610043565b60015f556001600160a01b0316608052610070565b5f60208284031215610053575f5ffd5b81516001600160a01b0381168114610069575f5ffd5b9392505050565b6080516109f861009d5f395f818161013e015281816102f20152818161043601526105d101526109f85ff3fe608060405234801561000f575f5ffd5b5060043610610060575f3560e01c80632d83549c146100645780635a1d305c146100de57806367d42a8b146100f35780637249fbb614610106578063f023b81114610119578063fc0c546a14610139575b5f5ffd5b6100c361007236600461085e565b600160208190525f9182526040909120805491810154600282015460038301546004909301546001600160a01b039485169490921692909167ffffffffffffffff811690600160401b900460ff1686565b6040516100d5969594939291906108a9565b60405180910390f35b6100f16100ec3660046108f7565b610178565b005b6100f161010136600461085e565b610383565b6100f161011436600461085e565b6104b8565b61012c61012736600461085e565b61064f565b6040516100d59190610960565b6101607f000000000000000000000000000000000000000000000000000000000000000081565b6040516001600160a01b0390911681526020016100d5565b610180610723565b5f5f86815260016020526040902060040154600160401b900460ff1660038111156101ad576101ad610875565b146101cb57604051631e76f79160e01b815260040160405180910390fd5b825f036101eb57604051631f2a200560e01b815260040160405180910390fd5b6040805160c0810182523381526001600160a01b03861660208201529081018490526060810183905267ffffffffffffffff8216608082015260a08101600190525f86815260016020818152604092839020845181546001600160a01b039182166001600160a01b031991821617835592860151938201805494909116939092169290921790559082015160028201556060820151600380830191909155608083015160048301805467ffffffffffffffff90921667ffffffffffffffff1983168117825560a086015193919268ffffffffffffffffff19161790600160401b9084908111156102dd576102dd610875565b021790555061031a9150506001600160a01b037f00000000000000000000000000000000000000000000000000000000000000001633308661074b565b604080518481526020810184905267ffffffffffffffff83168183015290516001600160a01b03861691339188917f4f6c8ec9481d8619704296e9db3aa775fd920d534ec45ef9e9e0fee3d20e11de919081900360600190a461037c60015f55565b5050505050565b61038b610723565b5f818152600160208190526040909120906004820154600160401b900460ff1660038111156103bc576103bc610875565b146103da57604051631834e26560e01b815260040160405180910390fd5b80546001600160a01b0316331461040457604051631435e35760e01b815260040160405180910390fd5b60048101805460ff60401b19166802000000000000000017905560018101546002820154610460916001600160a01b037f00000000000000000000000000000000000000000000000000000000000000008116929116906107b8565b600181015460028201546040519081526001600160a01b039091169083907fc8fa66dff4b9073528c3f1bf21a8dc9a18fdf09847e88e96188bc953aef519f09060200160405180910390a3506104b560015f55565b50565b6104c0610723565b5f818152600160208190526040909120906004820154600160401b900460ff1660038111156104f1576104f1610875565b1461050f57604051631834e26560e01b815260040160405180910390fd5b6004810154600182015467ffffffffffffffff90911642108015916001600160a01b03163314908261053f575080155b1561055d5760405163085de62560e01b815260040160405180910390fd5b82546001600160a01b03163314801590610584575060018301546001600160a01b03163314155b156105a25760405163c8ee2d1d60e01b815260040160405180910390fd5b60048301805460ff60401b191668030000000000000000179055825460028401546105fb916001600160a01b037f00000000000000000000000000000000000000000000000000000000000000008116929116906107b8565b825460028401546040519081526001600160a01b039091169085907ff552ca82e113ac3c539c3d617f29fcd19c172a0c75dad017555c9e109f7fe1839060200160405180910390a35050506104b560015f55565b6106846040805160c0810182525f8082526020820181905291810182905260608101829052608081018290529060a082015290565b5f82815260016020818152604092839020835160c08101855281546001600160a01b03908116825293820154909316918301919091526002810154928201929092526003808301546060830152600483015467ffffffffffffffff8116608084015291929160a0840191600160401b90910460ff169081111561070957610709610875565b600381111561071a5761071a610875565b90525092915050565b60025f540361074557604051633ee5aeb560e01b815260040160405180910390fd5b60025f55565b6040516001600160a01b0384811660248301528381166044830152606482018390526107b29186918216906323b872dd906084015b604051602081830303815290604052915060e01b6020820180516001600160e01b0383818316178352505050506107ee565b50505050565b6040516001600160a01b038381166024830152604482018390526107e991859182169063a9059cbb90606401610780565b505050565b5f5f60205f8451602086015f885af18061080d576040513d5f823e3d81fd5b50505f513d91508115610824578060011415610831565b6001600160a01b0384163b155b156107b257604051635274afe760e01b81526001600160a01b038516600482015260240160405180910390fd5b5f6020828403121561086e575f5ffd5b5035919050565b634e487b7160e01b5f52602160045260245ffd5b600481106108a557634e487b7160e01b5f52602160045260245ffd5b9052565b6001600160a01b03878116825286166020820152604081018590526060810184905267ffffffffffffffff8316608082015260c081016108ec60a0830184610889565b979650505050505050565b5f5f5f5f5f60a0868803121561090b575f5ffd5b8535945060208601356001600160a01b0381168114610928575f5ffd5b93506040860135925060608601359150608086013567ffffffffffffffff81168114610952575f5ffd5b809150509295509295909350565b81516001600160a01b03908116825260208084015190911690820152604080830151908201526060808301519082015260808083015167ffffffffffffffff169082015260a08281015160c08301916109bb90840182610889565b509291505056fea26469706673582212207e22af995f198c91f9ccd0fd637dc64e4290817853861d19dc3268e1237be7c564736f6c634300081c0033" as const;
