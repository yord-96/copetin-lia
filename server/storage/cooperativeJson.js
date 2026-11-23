import { setImmediate as yieldToRequests } from 'node:timers/promises';

// Stored state is JSON: split at collection rows instead of creating a second
// 100+ MB string and blocking every request during each stringify/parse.
export async function cloneState(state, collections = null) {
  const draft = {};
  let deadline = performance.now() + 8;
  for (const [key, value] of Object.entries(state)) {
    if (value === undefined) continue;
    if (collections && !collections.includes(key)) {
      draft[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      draft[key] = [];
      for (const row of value) {
        draft[key].push(JSON.parse(JSON.stringify(row ?? null)));
        if (performance.now() >= deadline) {
          await yieldToRequests();
          deadline = performance.now() + 8;
        }
      }
    } else {
      draft[key] = JSON.parse(JSON.stringify(value ?? null));
    }
  }
  return draft;
}

export async function* serializeState(state) {
  let chunk = '';
  let deadline = performance.now() + 8;
  async function* objectChunks(object) {
    chunk += '{';
    let first = true;
    for (const [key, value] of Object.entries(object)) {
      if (value === undefined) continue;
      chunk += `${first ? '' : ','}${JSON.stringify(key)}:`;
      first = false;
      if (Array.isArray(value)) {
        chunk += '[';
        for (let index = 0; index < value.length; index += 1) {
          chunk += `${index ? ',' : ''}${JSON.stringify(value[index] ?? null)}`;
          if (chunk.length >= 256 * 1024 || performance.now() >= deadline) {
            yield chunk;
            chunk = '';
            await yieldToRequests();
            deadline = performance.now() + 8;
          }
        }
        chunk += ']';
      } else if (value && typeof value === 'object' && !value.toJSON) {
        yield* objectChunks(value);
      } else {
        chunk += JSON.stringify(value);
      }
      if (performance.now() >= deadline) {
        yield chunk;
        chunk = '';
        await yieldToRequests();
        deadline = performance.now() + 8;
      }
    }
    chunk += '}';
  }
  yield* objectChunks(state);
  yield chunk;
}

export async function stringifyPayload(payload) {
  const chunks = [];
  for await (const chunk of serializeState(payload)) chunks.push(chunk);
  return chunks.join('');
}
