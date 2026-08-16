# pybudget-3

A mobile-friendly budgeting app in its first stage. The current version contains only Supabase email/password authentication.

## Current features

- Create an account with email and password
- Sign in and sign out
- Send a password-reset email
- Private dashboard visible only to authenticated users
- No budgeting or financial-data features yet

## Connect Supabase

1. Open your Supabase project.
2. Go to **Project Settings > API**.
3. Copy the **Project URL** and the **anon/public key**.
4. Open `config.js` and replace the two placeholder values.
5. Never put the Supabase `service_role` key in this repository.
6. In Supabase Authentication URL Configuration, set the Site URL to `https://grotshteyn.github.io/pybudget-3/`.

## Publish with GitHub Pages

In this repository, open **Settings > Pages**, select **Deploy from a branch**, choose `main` and `/(root)`, then save.

## Security

Supabase stores passwords. This application never reads or stores plaintext passwords.
