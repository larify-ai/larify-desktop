import Tinypool from 'tinypool'

export class WorkerService {
  private readonly pool = new Tinypool()

  run<Input, Output>(modulePath: string, input: Input): Promise<Output> {
    return this.pool.run(input, { filename: modulePath }) as Promise<Output>
  }

  destroy(): Promise<void> {
    return this.pool.destroy()
  }
}
