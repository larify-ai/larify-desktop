import './assets/main.css'
import { createRoot } from 'react-dom/client'
import { App } from './app/app'

const element = document.getElementById('root')
if (!element) throw new Error('Renderer root element is missing')

createRoot(element).render(<App />)
