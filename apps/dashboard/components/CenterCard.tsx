import Logo from "@/components/Logo";

/** Small centred card for signed-out pages (password reset, email confirmation). */
export default function CenterCard({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-wrap">
      <div className="card auth-card">
        <div style={{ marginBottom: 20 }}><Logo /></div>
        {children}
      </div>
    </main>
  );
}
