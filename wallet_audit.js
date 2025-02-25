import ecc from '@bitcoinerlab/secp256k1'; //https://www.npmjs.com/package/@bitcoinerlab/secp256k1
import * as bip39 from '@scure/bip39'; //https://www.npmjs.com/package/@scure/bip39
import { wordlist } from '@scure/bip39/wordlists/english'; //bip39 助记词库
import { BIP32Factory } from 'bip32'; //https://www.npmjs.com/package/bip32
import bs from 'bs58'; //https://www.npmjs.com/package/bs58
import { Keypair } from '@solana/web3.js'; //https://www.npmjs.com/package/@solana/web3.js
import { ethers } from 'ethers'; //https://www.npmjs.com/package/ethers
import slip10 from 'micro-key-producer/slip10.js'; //https://www.npmjs.com/package/micro-key-producer
import AsyncStorage from '@react-native-async-storage/async-storage'; //https://www.npmjs.com/package/@react-native-async-storage/async-storage
import { v4 as uuidv4 } from 'uuid'; //https://www.npmjs.com/package/uuid
import * as Keychain from 'react-native-keychain'; //https://www.npmjs.com/package/react-native-keychain
import axios from 'axios'; //https://www.npmjs.com/package/axios


//内部加密存储方法
const setKeychainValue = async (key, value) => {
    try {
        await Keychain.setGenericPassword(key, value, {
            service: key,
            accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
        });
    } catch (error) {
        throw new Error(`加密存储错误： ${error.message}`);
    }
}

const removeKeychainValue = async (key) => {
    try {
        await Keychain.resetGenericPassword({
            service: key,
        });
    } catch (error) {
        throw new Error(`移除加密错误： ${error.message}`);
    }
}

const getKeychainValue = async (key) => {
    try {
        const keychainValue = await Keychain.getGenericPassword({
            service: key,
        });
        return keychainValue.password
    } catch (error) {
        throw new Error(`获取加密错误： ${error.message}`);
    }
}



//根据助记词生成地址，内部方法
const generateAddresses = async (mnemonic, index) => {
    try {
        const seed = await bip39.mnemonicToSeed(mnemonic);
        const bip32 = BIP32Factory(ecc);
        const root = bip32.fromSeed(seed);

        // 生成以太坊地址
        const ethPath = "m/44'/60'/0'/0/" + index; // BIP44 路径
        const ethNode = root.derivePath(ethPath);
        const ethPrivateKey = Array.from(ethNode.privateKey).map(byte => byte.toString(16).padStart(2, '0')).join('');
        const wallet = new ethers.Wallet(ethPrivateKey);
        const ethAddress = wallet.address;

        // 生成sol地址
        const solPath = "m/44'/501'/" + index + "'/0'"; // BIP44 路径
        const hd = slip10.fromMasterSeed(Buffer.from(seed));
        const keypair = Keypair.fromSeed(hd.derive(solPath).privateKey.slice(0, 32));
        const solPrivateKey = bs.encode(keypair.secretKey);
        const solAddress = keypair.publicKey.toBase58();

        const uuid = uuidv4();

        //组装列表
        const generateAddresseslist = [
            {
                generateType: 'EVM',
                address: ethAddress,
                privateKey: ethPrivateKey,
            },
            {
                generateType: 'Solana',
                address: solAddress,
                privateKey: solPrivateKey,
            }
        ]

        //加密存储助记词
        const walletServiceName = 'wallet_' + uuid;
        await setKeychainValue(walletServiceName, mnemonic)

        //遍历加密存储私钥
        for (let i = 0; i < generateAddresseslist.length; i++) {
            const addressServiceName = 'address_' + generateAddresseslist[i].address + '_type_' + generateAddresseslist[i].generateType;
            await setKeychainValue(addressServiceName, generateAddresseslist[i].privateKey)
        }

        return {
            uuid: uuid,
            addressList: [
                {
                    generateType: 'EVM',
                    address: ethAddress,

                },
                {
                    generateType: 'Solana',
                    address: solAddress,
                }
            ]
        }
    } catch (error) {
        throw new Error(`生成地址失败： ${error.message}`);
    }
}

//导入私钥钱包，内部方法
const createWalletByPrivateKey = async (privateKey, type) => {

    let addressServiceName;
    let address; //问题d
    try {

        if (type === 'EVM') {
            const wallet = new ethers.Wallet(privateKey);
            addressServiceName = 'address_' + wallet.address + '_type_' + type;
            address = wallet.address;

        } else if (type === 'Solana') {
            const keypair = Keypair.fromSecretKey(bs.decode(privateKey));
            const solAddress = keypair.publicKey.toBase58();
            addressServiceName = 'address_' + solAddress + '_type_' + type;
            address = solAddress;

        }

        await setKeychainValue(addressServiceName, privateKey)

        return {
            uuid: uuidv4(),
            addressList: [
                {
                    generateType: type,
                    address: address,
                },
            ]

        }
    } catch (error) {
        throw new Error(`导入私钥失败： ${error.message}`);
    }

}

let isGetNextWalletId = true;
//这里方式是同步执行 用户重复点击已经在业务逻辑层面处理完成，不会出现重复的id
const getNextWalletId = async () => {
    try {
        let walletId;
        if (isGetNextWalletId) {
            isGetNextWalletId = false;
            const id = await AsyncStorage.getItem('@walletId');
            walletId = +id + 1
            await AsyncStorage.setItem('@walletId', walletId.toString());
            isGetNextWalletId = true;
        }
        return walletId;
    } catch (error) {
        isGetNextWalletId = true;
        throw new Error(`获取id失败： ${error.message}`);
    }
}

//创建多链钱包
const createWallet = async () => {
    try {
        const secretPhrase = bip39.generateMnemonic(wordlist); //生成12位随机助记词
        const { uuid, addressList } = await generateAddresses(secretPhrase, 0); //通过助记词生成地址和私钥

        const id = await getNextWalletId()

        const walletObject = {
            uuid: uuid, //钱包uuid
            addressList: addressList, //地址集合
            type: 1, // 1 =>hd钱包， 2 =>私钥钱包
            source: 1, //1 =>创建 2 =>恢复
            avatar: 1, //头像
            name: `Wallet ${id}`, //钱包名称
            status: 0,  // 0 =>未备份， 1 =>已备份 2 => 导入
            balance: 0,  //余额
        };
        return walletObject
    } catch (error) {
        throw new Error(`创建多链钱包失败： ${error.message}`);
    }
};

//删除钱包
const deleteWallet = async (uuid) => {
    try {
        const newWallets = _.filter(wallets, wallet => wallet.uuid !== uuid);
        //删除加密后的助记词

        await removeKeychainValue('wallet_' + uuid)

        //遍历删除加密后的私钥
        for (let i = 0; i < wallets.length; i++) {
            if (wallets[i].uuid === uuid) { //根据问题E建议，删除与提供的uuid匹配的钱包的私钥
                await removeKeychainValue('address_' + wallets[i].address + '_type_' + wallets[i].generateType)
            }
        }

        return newWallets;
    } catch (error) {
        throw new Error(`删除钱包失败： ${error.message}`);

    }
}


//通过私钥导入钱包
const importWalletByPrivateKey = async ({ privateKey, type }) => {
    try {

        const addressesParams = await createWalletByPrivateKey(privateKey, type); //生成地址
        const { uuid, addressList } = addressesParams;
        const id = await getNextWalletId() //生成id

        const walletObject = {
            uuid: uuid, //钱包id
            addressList: addressList, //地址集合
            type: 2, // 1 =>hd钱包， 2 =>私钥钱包
            source: 2, //1 =>创建 2 =>恢复
            avatar: 1, //头像
            name: `Wallet ${id}`, //钱包名称
            status: 2,  // 0 =>未备份， 1 =>已备份 2 => 导入
            balance: 0, //余额
        };
        return walletObject

    } catch (error) {
        throw new Error(`导入私钥钱包失败： ${error.message}`);
    }
};


//通过助记词导入钱包
const importWalletByMnemonic = async (mnemonic) => {
    try {
        const id = await getNextWalletId() //生成id
        const { uuid, addressList } = await generateAddresses(mnemonic, 0); //通过助记词生成地址和私钥

        const walletObject = {
            uuid: uuid, //钱包id
            addressList: addressList, //地址集合
            type: 1, // 1 =>hd钱包， 2 =>私钥钱包
            source: 2, //1 =>创建 2 =>恢复
            avatar: 1, //头像
            name: `Wallet ${id}`, //名称
            status: 2,  // 0 =>未备份， 1 =>已备份, 2 => 导入
            balance: 0, //余额
        };
        return walletObject

    } catch (error) {

        throw new Error(`通过助记词导入钱包失败： ${error.message}`);
    }
};


//查看钱包助记词
const mnemonic = getKeychainPassword('wallet_' + uuid);
//查看地址的私钥
const privateKey = getKeychainPassword('address_' + address + '_type_' + type);


//内部方法获取Keychain存储的内容
const getKeychainPassword = async (serviceName) => {
    try {
        const keychainPassword = await getKeychainValue(serviceName)
        return keychainPassword;
    } catch (error) {
        throw new Error(`Keychain存储失败： ${error.message}`);
    }
}


//evm 签名
const evmSign = async (wallet, tx) => {
    try {
        const signTransactionParams = {
            chainId: tx.chainId,
            from: tx.from,
            to: tx.to,
            value: tx.value,
            maxFeePerGas: tx.maxFeePerGas,
            maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
            gas: tx.gas,
            nonce: tx.nonce,
            data: tx.data,
            type: 2 // 指定为 EIP-1559 交易
        };

        const privateKey = await getKeychainPassword('address_' + wallet.address + '_type_' + wallet.type);

        const { rawTransaction } = await web3.eth.accounts.signTransaction(
            signTransactionParams,
            privateKey
        );
        return rawTransaction;
    } catch (error) {
        throw new Error(`evm签名失败： ${error.message}`);
    }
}
//sol 签名
const solSign = async (wallet, swapTransaction) => {

    try {
        const privateKey = await getKeychainPassword('address_' + wallet.address + '_type_' + wallet.type);

        const wallet = solanaWeb3.Keypair.fromSecretKey(bs.decode(privateKey));
        const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
        var transaction = solanaWeb3.VersionedTransaction.deserialize(swapTransactionBuf);
        transaction.sign([wallet]);
        const rawTransaction = transaction.serialize();
        const transactionVal = bs.encode(rawTransaction);
        return transactionVal;
    } catch (error) {
        throw new Error(`sol签名失败： ${error.message}`);
    }
}



//获取兑换前待签名数据
const getSwapData = async (data) => {
    const result = await axios.post('/web3/swap/getSwapData', data)
    return result.data;
}

//获取转账前待签名数据
const getWithdrawalData = async (data) => {
    const result = await axios.post('/web3/wallet/withdrawalData', data)
    return result.data;
}

//获取授权前待签名数据
const getApproveData = async (data) => {
    const result = await axios.post('/web3/swap/approve', data)
    return result.data;
}

//签名后，广播交易
const broadcast = async (data) => {
    const result = await axios.post('/web3/wallet/broadcast', data)
    return result.data;
}


//兑换
const handleSwap = async () => {
    //第一步 获取兑换Data
    const swapData = await getSwapData({
        chainId,
        fromTokenAddress,
        toTokenAddress,
        amount,
        slippage,
        fromAddress,
        quoteResponse
    })
    //第二步 本地签名
    let broadcastData;
    if (wallet.generateType === 'EVM') {
        broadcastData = await evmSign(wallet, swapData);
    } else if (wallet.generateType === 'Solana') {
        broadcastData = await solSign(wallet, swapData.solTransferData);
    }
    //第三步 广播交易
    const swapBroadcastData = {
        chainId: chainId,
        fromAddress: fromAddress,
        toAddress: toAddress,
        contractAddress: contractAddress,
        transactionData: broadcastData,
        type: 'Swap', //  Send  Swap  Approve
        qty: qty,
        walletId: walletId,
        memberId: memberId,
        swapFromAddress: swapFromAddress,
        swapToAddress: swapToAddress,
        swapFromQty: swapFromQty,
        swapToQty: swapToQty,
    }
    await broadcast(swapBroadcastData);
}

//转账
const handleWithdrawal = async () => {
    //第一步 获取转账Data
    const withdrawalData = await getWithdrawalData({
        chainId,
        contractAddress,
        toAddress,
        qty,
        fromAddress,
        gasLimit,
        nonce
    })
    //第二步 本地签名
    let broadcastData;
    if (wallet.generateType === 'EVM') {
        broadcastData = await evmSign(wallet, withdrawalData);
    } else if (wallet.generateType === 'Solana') {
        broadcastData = await solSign(wallet, withdrawalData.solTransferData);
    }
    //第三步 广播交易
    const withdrawalBroadcastData = {
        chainId: chainId,
        contractAddress: contractAddress,
        fromAddress: fromAddress,
        toAddress: toAddress,
        qty: qty,
        transactionData: broadcastData,
        type: 'Send', //  Send  Swap  Approve
        walletId: walletId,
        memberId: memberId,
    }
    await broadcast(withdrawalBroadcastData);
}

//授权
const handleApprove = async () => {
    //第一步 获取兑换Data
    const approveData = await getApproveData({
        chainId,
        fromTokenAddress,
        toTokenAddress,
        gasLimit,
        nonce
    })
    //第二步 本地签名
    let broadcastData;
    if (wallet.generateType === 'EVM') {
        broadcastData = await evmSign(wallet, approveData);
    } else if (wallet.generateType === 'Solana') {
        broadcastData = await solSign(wallet, approveData.solTransferData);
    }
    //第三步 广播交易
    const approveBroadcastData = {
        chainId: chainId,
        fromAddress: fromAddress,
        toAddress: toAddress,
        transactionData: broadcastData,
        type: 'Approve', //  Send  Swap  Approve
        walletId: walletId,
        memberId: memberId,
        swapFromAddress: swapFromAddress,
        swapToAddress: swapToAddress,
        swapFromQty: swapFromQty,
        swapToQty: swapToQty,
    }
    await broadcast(approveBroadcastData);
}
