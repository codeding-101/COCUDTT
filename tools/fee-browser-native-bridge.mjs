/** Dedicated observation harness only. Transforming app instrumentation never transforms the native codec. */
import {feeLayeredSourceBridge} from './fee-layered-source-bridge.mjs';
function once(code, from, to) {if(code.split(from).length!==2)throw Error('Native observation harness changed');return code.replace(from,to);}
let bridge=once(feeLayeredSourceBridge,'inspectFeeLayeredSourceMapping as inspectSource89','inspectFeeBrowserNativeMapping as inspectSource89');
bridge=once(bridge,"from '../../tools/fee-layered-source-diagnostic.ts'","from '../../tools/fee-browser-native-diagnostic.ts'");
bridge=once(bridge,"import {encodeFeeLayeredCapturePrototype as encode95,decodeFeeLayeredCapturePrototype as decode95,inspectFeeLayeredCaptureBudget as budget95,FeeLayeredCapturePrototype as Session95} from '../../tools/fee-layered-capture-prototype.ts';",
 "import {encodeFeeBrowserNativeCapture as encode95,decodeFeeBrowserNativeCapture as decode95,inspectFeeBrowserNativeCaptureBudget as budget95,feeBrowserNativeCodec as codec97} from '../../tools/fee-browser-native-codec.ts';\nimport {FeeBrowserCaptureContract as Session95} from '../../tools/fee-browser-capture-contract.ts';");
bridge=bridge.replaceAll('FEE_LAYERED_CAPTURE_PROTOTYPE_', 'FEE_BROWSER_NATIVE_CODEC_').replaceAll('session.encode(', 'session.exportWire(');
bridge=once(bridge,'new Session95(workbenchState)','new Session95(workbenchState,codec97)');
bridge=once(bridge,"stale=fixedReason95(error)==='FEE_BROWSER_NATIVE_CODEC_STALE'","stale=fixedReason95(error)==='FEE_BROWSER_CAPTURE_CONTRACT_STALE'");
bridge=once(bridge,'FEE_BROWSER_NATIVE_CODEC_[A-Z_]+)$','(?:FEE_BROWSER_NATIVE_CODEC_[A-Z_]+|FEE_BROWSER_CAPTURE_CONTRACT_[A-Z_]+))$');
export const feeBrowserNativeBridge=bridge;
