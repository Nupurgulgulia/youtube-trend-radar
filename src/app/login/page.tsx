import LoginForm from "./LoginForm";

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <>
      <h1>Admin login</h1>
      <p className="muted">Needed for Settings and for saving Film, Skip or Investigate.</p>
      <LoginForm next={next ?? "/"} />
    </>
  );
}
