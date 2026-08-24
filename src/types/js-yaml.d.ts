// Minimal ambient declaration for js-yaml (avoid adding @types dev-deps
// that could disrupt the running dev server / lockfile).
declare module "js-yaml" {
  export function load(input: string, options?: any): any;
  export function safeLoad(input: string, options?: any): any;
  export function dump(obj: any, options?: any): string;
  export interface LoadFunction {
    (input: string, options?: any): any;
  }
}
