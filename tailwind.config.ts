import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#040816',
          900: '#09111f',
          800: '#111d31'
        },
        signal: {
          cyan: '#7dd3fc',
          mint: '#34d399',
          amber: '#fbbf24',
          rose: '#fb7185'
        }
      },
      boxShadow: {
        panel: '0 24px 80px rgba(2, 6, 23, 0.48)',
        glow: '0 0 0 1px rgba(125, 211, 252, 0.18), 0 28px 120px rgba(14, 165, 233, 0.12)'
      },
      keyframes: {
        drift: {
          '0%, 100%': { transform: 'translate3d(0, 0, 0)' },
          '50%': { transform: 'translate3d(0, -12px, 0)' }
        },
        pulseSoft: {
          '0%, 100%': { opacity: '0.55', transform: 'scale(0.96)' },
          '50%': { opacity: '1', transform: 'scale(1)' }
        },
        sheen: {
          '0%': { transform: 'translateX(-120%)' },
          '100%': { transform: 'translateX(120%)' }
        }
      },
      animation: {
        drift: 'drift 10s ease-in-out infinite',
        'pulse-soft': 'pulseSoft 1.8s ease-in-out infinite',
        sheen: 'sheen 2.8s linear infinite'
      }
    }
  },
  plugins: []
} satisfies Config;
