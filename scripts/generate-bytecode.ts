import { ethers } from 'ethers';

const artifact = {};

const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode);

const config = {};

console.log(
  JSON.stringify(factory.getDeployTransaction(/* Put here deployment args */)),
);
