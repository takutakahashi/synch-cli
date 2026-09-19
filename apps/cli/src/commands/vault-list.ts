import type { CliAppContext } from "../app/context";
import { writeJson, writeStdout } from "../app/output";

export async function runVaultList(
  ctx: CliAppContext,
  json: boolean,
): Promise<number> {
  await ctx.initializeAuth();
  ctx.requireVerifiedAuth();

  const vaults = await ctx.remoteVaultManager.listRemoteVaults();
  const connectedVaultId =
    ctx.credentials.getVaultCredential(ctx.vaultPath)?.remoteVaultId ?? null;

  if (json) {
    writeJson({
      apiBaseUrl: ctx.apiBaseUrl,
      connectedVaultId,
      vaults: vaults.map((vault) => ({
        id: vault.id,
        name: vault.name,
        organizationId: vault.organizationId,
        activeKeyVersion: vault.activeKeyVersion,
        createdAt: vault.createdAt,
      })),
    });
    return 0;
  }

  if (vaults.length === 0) {
    writeStdout("No remote vaults. Create one with `synch vault create --name <name>`.");
    return 0;
  }

  for (const vault of vaults) {
    const marker = vault.id === connectedVaultId ? "*" : " ";
    writeStdout(`${marker} ${vault.id}  ${vault.name}`);
  }
  writeStdout("");
  writeStdout("(*) connected to this directory");

  return 0;
}
