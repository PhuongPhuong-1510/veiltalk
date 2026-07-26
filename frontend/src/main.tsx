import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { useAuthStore } from './lib/store/authStore'
import App from './App.tsx'

// Bootstrap auth trước khi render để mọi API consumer đều dùng hook đã cấu hình.
useAuthStore.getState()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
