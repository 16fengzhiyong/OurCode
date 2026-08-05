declare module 'picomatch' {
  function picomatch(pattern: string | string[], options?: any): (test: string) => boolean
  export = picomatch
}
