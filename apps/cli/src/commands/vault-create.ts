import { validateVaultPassword } from "@synch/sync-client";
import { RemoteVaultInputError } from "@synch/sync-client/remote";

import type { CliAppContext } from "../app/context";
import { CliUsageError, describeError } from "../app/context";
import { promptVaultPassword } from "./prompt";

export async function runVaultCreate(
  ctx: CliAppContext,
  name: string | undefined,
): Promise<number> {
  if (!name?.trim()) {
    throw new CliUsageError(
      "Missing --name. Usage: synch vault create --name <name> [--vault <path>]",
    );
  }

  await ctx.initializeAuth();
  ctx.requireVerifiedAuth();

  const password = await promptVaultPassword({ confirm: true });
  const validation = validateVaultPassword(password);
  if (!validation.ok) {
    throw new CliUsageError(validation.message);
  }

  try {
    const summary = await ctx.remoteVaultManager.createRemoteVault({
      name: name.trim(),
      password,
      confirmPassword: password,
    });

    await ctx.openVaultSession();
    ctx.logger.log(`Created vault "${summary.vaultName}" (${summary.vaultId}).`);
    ctx.logger.log(`Vault directory: ${ctx.vaultPath}`);
    ctx.logger.log("Run `synch sync` to synchronize, or `synch watch` to keep syncing.");
    return 0;
  } catch (error) {
    if (error instanceof RemoteVaultInputError) {
      throw new CliUsageError(describeRemoteVaultInputError(error));
    }
    throw error;
  }
}

function describeRemoteVaultInputError(error: RemoteVaultInputError): string {
  switch (error.failure.kind) {
    case "name_required":
      return "Vault name is required.";
    case "password_mismatch":
      return "Passwords do not match.";
    case "invalid_password":
      return error.failure.validation.message;
    default:
      return describeError(error);
  }
}
