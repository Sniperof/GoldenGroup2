import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'framer-motion';
import { Toaster } from 'sonner';
import './index.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        {/* reducedMotion="user" makes every framer-motion animation app-wide
            honor prefers-reduced-motion without per-component guards. */}
        <MotionConfig reducedMotion="user">
            <App />
            {/* Single app-wide toast host. Plain (no richColors) so the brand
                toast styling in index.css ([data-sonner-toast]) applies. */}
            <Toaster position="top-center" dir="rtl" closeButton />
        </MotionConfig>
    </StrictMode>,
);
