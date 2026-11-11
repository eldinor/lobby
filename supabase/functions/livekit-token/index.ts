import { createTokenHandler } from './handler.ts';

Deno.serve(createTokenHandler(name => Deno.env.get(name)));
