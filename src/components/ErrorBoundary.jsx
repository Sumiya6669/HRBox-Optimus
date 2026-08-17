import React from 'react';

/**
 * Ловит ошибки рендера, чтобы вместо белого экрана пользователь видел объяснение.
 * Белая страница без единого сообщения — худший из возможных отказов:
 * непонятно ни пользователю, ни поддержке.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[Optimus KZ] Ошибка рендера:', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24, fontFamily: "'Inter', system-ui, sans-serif", background: '#F3F4F6', color: '#111827',
      }}>
        <div style={{ maxWidth: 520, textAlign: 'center' }}>
          <div style={{
            width: 48, height: 48, borderRadius: 999, background: '#FFE5E8', color: '#C4001A',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px', fontSize: 24, fontWeight: 700,
          }} aria-hidden="true">!</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px' }}>
            Портал не удалось загрузить
          </h1>
          <p style={{ fontSize: 14, color: '#4B5563', margin: '0 0 16px' }}>
            Произошла ошибка при отрисовке страницы. Обновите вкладку — если ошибка
            повторяется, передайте администратору портала текст ниже.
          </p>
          <pre style={{
            fontSize: 12, textAlign: 'left', background: '#fff', border: '1px solid #E5E7EB',
            borderRadius: 8, padding: 12, overflow: 'auto', maxHeight: 180, color: '#111827',
          }}>
            {String(this.state.error?.message || this.state.error)}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 16, minHeight: 40, padding: '0 20px', borderRadius: 8, border: 'none',
              background: '#C4001A', color: '#fff', fontSize: 14, fontWeight: 500, cursor: 'pointer',
            }}
          >
            Обновить страницу
          </button>
        </div>
      </div>
    );
  }
}
