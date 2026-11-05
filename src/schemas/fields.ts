import { Buffer } from 'node:buffer';
import * as z from 'zod/v4';

export const objectOptions = {
  error: 'Expected an object with only documented fields',
};

export function boundedText(maxBytes: number) {
  return z
    .string()
    .max(maxBytes)
    .refine((value) => Buffer.byteLength(value) <= maxBytes, {
      error: `Must be at most ${maxBytes} UTF-8 bytes`,
    })
    .refine((value) => !value.includes('\0'), {
      error: 'Must not contain a NUL character',
    });
}

export const description = boundedText(2000).refine(
  (value) => value.trim().length > 0,
  { error: 'Must contain text' },
);
export const label = boundedText(128).refine(
  (value) => value.length > 0 && value === value.trim(),
  { error: 'Must be nonempty and have no surrounding whitespace' },
);
export const id = z.uuidv4();
export const inputId = id.toLowerCase();
