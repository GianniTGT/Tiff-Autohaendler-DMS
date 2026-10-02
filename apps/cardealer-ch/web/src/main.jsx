import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
// Schriften selbst ausgeliefert (kein Aufruf bei Google Fonts — revDSG).
import '@fontsource/barlow/400.css'
import '@fontsource/barlow/500.css'
import '@fontsource/barlow/600.css'
import '@fontsource/barlow-condensed/600.css'
import '@fontsource/barlow-condensed/700.css'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
