import { prisma } from '../db.js';

export async function getOrCreateOrgSettings() {
  let s = await prisma.orgSettings.findUnique({ where: { id: 'singleton' } });
  if (!s) {
    s = await prisma.orgSettings.create({
      data: { id: 'singleton', companyName: 'PulseTrack Team' },
    });
  }
  return s;
}

export async function updateOrgSettings(data) {
  await getOrCreateOrgSettings();
  return prisma.orgSettings.update({
    where: { id: 'singleton' },
    data,
  });
}
