import type { Application } from '../app/application'
import { defineService } from '@shared/infra/registry'
import { registerDialogIpc } from './ipc'

const dialogToken = defineService()

export function registerDialog(application: Application): void {
  application.registry.register(dialogToken, registerDialogIpc(application))
}
