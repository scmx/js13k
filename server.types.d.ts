type ArgOfCallbackParam<
  F,
  ParamIndex extends number,
  ArgIndex extends number,
> = Parameters<NonNullable<Parameters<F>[ParamIndex]>>[ArgIndex];

type Req = ArgOfCallbackParam<typeof import("node:http").createServer, 1, 0>;
type Res = ArgOfCallbackParam<typeof import("node:http").createServer, 1, 1>;
