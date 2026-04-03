import './Login.css'

export default function Login() {
  return (
    <div className="login-page">
      <div className="login-card">
        <h1 className="login-title">SNI Research</h1>
        <p className="login-subtitle">Editorial intelligence platform</p>
        <a href="/api/auth/login" className="login-button">
          Sign in with Google
        </a>
      </div>
    </div>
  )
}
