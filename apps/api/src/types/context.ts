export type AuthenticatedTenant = {
  id: string;
  name: string;
  slug: string;
};

export type ApiKeyContext = {
  id: string;
  permissions: string[];
};

export type AppVariables = {
  requestId: string;

  tenant: AuthenticatedTenant;
  apiKey: ApiKeyContext;
};
