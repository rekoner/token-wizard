import { findConstructor, getconstructorParams, toFixed } from '../utils/utils'

export function getEncodedABIClientSide(web3, abi, state, vals, crowdsaleNum, cb) {
	//console.log(web3, abi, state, vals, crowdsaleNum);
	const abiConstructor = findConstructor(abi, state)
    let params = getconstructorParams(abiConstructor, state, vals, crowdsaleNum);

    getABIencoded(web3, params.types, params.vals, function(encoded) {
		cb(encoded);
	});
}

function getABIencoded(web3, types, vals, cb) {
	if (vals) {
		for (let i = 0; i < vals.length; i++) {
			let val = vals[i];
			if( Object.prototype.toString.call( val ) === '[object Array]' ) {
				for (let j = 0; j < val.length; j++) {
			    	if (val[j]) {
			    		vals[i][j] = toFixed(val[j]);
			    	}
			    }
			}
		}
	}

	console.log(types);
	console.log(vals);

	let encoded = web3.eth.abi.encodeParameters(types, vals);
	let outputRaw = encoded.toString("hex")
	let output = outputRaw.indexOf("0x") > -1?outputRaw.substr(2):outputRaw
	cb(output);
}