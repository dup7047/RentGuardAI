import { ResetPasswordForm } from './ResetPasswordForm';

type SearchParams = Promise<{
  token_hash?: string | string[];
  type?: string | string[];
}>;

function pickFirst(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const tokenHash = pickFirst(params.token_hash);
  const type = pickFirst(params.type);

  return (
    <main className="auth-shell">
      <ResetPasswordForm tokenHash={tokenHash} type={type} />
    </main>
  );
}
