import { ModelRegistry } from '@huggingface/transformers';
import * as ort from 'onnxruntime-node';

const model = 'onnx-community/whisper-large-v3-ONNX';
const dtypes = await ModelRegistry.get_available_dtypes(model);
if (!dtypes.includes('q4')) throw new Error(`${model} does not expose a complete q4 encoder/decoder set`);
if (!ort.env?.versions?.node) throw new Error('onnxruntime-node did not load its native runtime');
console.log(JSON.stringify({ model, quantization: 'q4', available: true, onnxRuntime: ort.env.versions }, null, 2));
