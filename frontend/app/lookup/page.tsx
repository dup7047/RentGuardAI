import { redirect } from 'next/navigation';

// /lookup is the old entry point — canonical is now /.
export default function LookupPage() {
  redirect('/');
}
