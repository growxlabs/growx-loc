export type AuthenticatedTenant = {
  id: string;
  name: string;
  slug: string;
};

export type ApiKeyContext = {
  id: string;
  permissions: string[];
};

export type AdminActor = {
  id: string;
  email: string;
};

export type AppVariables = {
  requestId: string;

  tenant: AuthenticatedTenant;
  apiKey: ApiKeyContext;

  // Set only on /admin/* by the admin-auth middleware.
  adminActor: AdminActor;
};
