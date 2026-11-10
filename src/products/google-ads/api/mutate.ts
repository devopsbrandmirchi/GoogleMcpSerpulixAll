import { AppError } from "@/lib/errors";
import { resolveAdsAccessContext } from "@/products/google-ads/routing";
import { adsRequest, requireAccessToken, searchGoogleAds } from "@/products/google-ads/api/client";
import {
  assertClientAccount,
  assertWriteAllowed,
  checkMutateOperations,
  type OperationSummary,
} from "@/products/google-ads/api/write-policy";

export const NO_RETRY_NOTE =
  "Do not retry an ambiguous timeout automatically; read the affected resources first, because a timed-out mutation might have succeeded.";

export interface GuardedMutateParams {
  customerId: string;
  connectionId?: string;
  operations: unknown[];
  validateOnly: boolean;
  confirm: boolean;
}

export interface GuardedMutateResult {
  customerId: string;
  googleAccount: string | null;
  validated: boolean;
  executed: boolean;
  operations: OperationSummary[];
  result: unknown;
  requestId: string | null;
  note: string;
}

async function assertCriteriaDetachable(params: {
  customerId: string;
  resourceNames: string[];
  accessToken: string;
  loginCustomerId: string | null;
}): Promise<void> {
  if (params.resourceNames.length === 0) {
    return;
  }
  const list = params.resourceNames.map((name) => `'${name}'`).join(", ");
  const { results } = await searchGoogleAds({
    customerId: params.customerId,
    accessToken: params.accessToken,
    loginCustomerId: params.loginCustomerId,
    query: `SELECT ad_group_criterion.resource_name, ad_group_criterion.type, ad_group_criterion.negative FROM ad_group_criterion WHERE ad_group_criterion.resource_name IN (${list})`,
  });
  const found = new Map<string, { type?: string; negative?: boolean }>();
  for (const row of results) {
    const criterion = (row as { adGroupCriterion?: { resourceName?: string; type?: string; negative?: boolean } })
      .adGroupCriterion;
    if (criterion?.resourceName) {
      found.set(criterion.resourceName, criterion);
    }
  }
  for (const name of params.resourceNames) {
    const criterion = found.get(name);
    if (!criterion) {
      throw new AppError(`Ad group criterion ${name} was not found.`, "validation", 400);
    }
    if (criterion.type === "KEYWORD" && !criterion.negative) {
      throw new AppError(
        `Ad group criterion ${name} is a keyword, which this connector does not delete. Pause it instead.`,
        "validation",
        400,
      );
    }
  }
}

export async function executeGuardedMutate(params: GuardedMutateParams): Promise<GuardedMutateResult> {
  const customerId = assertWriteAllowed(params.customerId);
  const checked = checkMutateOperations(customerId, params.operations);
  if (!params.validateOnly && !params.confirm) {
    throw new AppError(
      "Review the validated plan and obtain user approval before setting confirm=true and validateOnly=false.",
      "validation",
      400,
    );
  }

  const access = await resolveAdsAccessContext(customerId, params.connectionId);
  assertClientAccount(access);
  const accessToken = requireAccessToken((await access.client.getAccessToken()).token);

  await assertCriteriaDetachable({
    customerId: access.customerId,
    resourceNames: checked.adGroupCriterionRemovals,
    accessToken,
    loginCustomerId: access.loginCustomerId,
  });

  const response = await adsRequest({
    path: `/customers/${access.customerId}/googleAds:mutate`,
    method: "POST",
    accessToken,
    loginCustomerId: access.loginCustomerId,
    body: {
      mutateOperations: checked.operations,
      validateOnly: params.validateOnly,
      partialFailure: false,
      responseContentType: "MUTABLE_RESOURCE",
    },
  });

  return {
    customerId: access.customerId,
    googleAccount: access.googleEmail,
    validated: params.validateOnly,
    executed: !params.validateOnly,
    operations: checked.summary,
    result: response.body,
    requestId: response.requestId,
    note: NO_RETRY_NOTE,
  };
}
