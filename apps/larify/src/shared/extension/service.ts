const serviceType: unique symbol = Symbol()

export interface Service<T> {
  name: string
  [serviceType]?: T
}

export function defineService<T>(name: string): Service<T> {
  return { name }
}
