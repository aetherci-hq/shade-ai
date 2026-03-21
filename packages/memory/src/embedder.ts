type Pipeline = (text: string, opts: { pooling: string; normalize: boolean }) => Promise<{ data: ArrayLike<number> }>;

let instance: Pipeline | null = null;
let initPromise: Promise<void> | null = null;

async function loadModel(): Promise<void> {
  // Dynamic import — @xenova/transformers is ESM-only
  const { pipeline } = await import('@xenova/transformers');
  instance = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2') as unknown as Pipeline;
}

function ensureReady(): Promise<void> {
  if (instance) return Promise.resolve();
  if (!initPromise) {
    initPromise = loadModel();
  }
  return initPromise;
}

export async function embed(text: string): Promise<Float32Array> {
  await ensureReady();
  const output = await instance!(text, { pooling: 'mean', normalize: true });
  return new Float32Array(output.data);
}

export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  await ensureReady();
  const results: Float32Array[] = [];
  for (const text of texts) {
    results.push(await embed(text));
  }
  return results;
}

export const EMBEDDING_DIM = 384;
