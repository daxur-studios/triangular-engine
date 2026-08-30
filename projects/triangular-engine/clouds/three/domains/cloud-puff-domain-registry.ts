import { BOX_CLOUD_PUFF_DOMAIN } from './box-domain';
import { CYLINDER_INTERIOR_CLOUD_PUFF_DOMAIN } from './cylinder-interior-domain';
import { SPHERE_SHELL_CLOUD_PUFF_DOMAIN } from './sphere-shell-domain';
import type { ICloudPuffDomain } from './cloud-puff-domain';

/** All available placement domains, in the order they should be offered in a picker. */
export const CLOUD_PUFF_DOMAINS: readonly ICloudPuffDomain[] = [
  SPHERE_SHELL_CLOUD_PUFF_DOMAIN,
  BOX_CLOUD_PUFF_DOMAIN,
  CYLINDER_INTERIOR_CLOUD_PUFF_DOMAIN,
];

export const DEFAULT_CLOUD_PUFF_DOMAIN_ID: string = SPHERE_SHELL_CLOUD_PUFF_DOMAIN.id;

export function getCloudPuffDomainById(id: string): ICloudPuffDomain {
  return CLOUD_PUFF_DOMAINS.find((domain) => domain.id === id) ?? SPHERE_SHELL_CLOUD_PUFF_DOMAIN;
}
