import { PrismaClient, AttendanceStatus, LeaveStatus, LeaveType, AnomalyType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const MEMBER_NAMES = [
  'Alex Rivera',
  'Jordan Kim',
  'Sam Patel',
  'Taylor Brooks',
  'Casey Nguyen',
  'Morgan Lee',
  'Riley Chen',
  'Quinn Adams',
];

async function main() {
  await prisma.orgSettings.upsert({
    where: { id: 'singleton' },
    create: {
      id: 'singleton',
      companyName: 'PulseTrack Demo',
      timezone: 'Asia/Islamabad',
      expectedWindowStartMin: 540,
      expectedWindowEndMin: 1020,
      graceMinutes: 5,
      requiredHoursMin: 480,
      pointRules: {
        onTimeClockIn: 5,
        fullHours: 10,
        overtimeHour: 15,
        streakBonus: 500,
        unexcusedAbsent: -30,
        lateWithoutNote: -10,
      },
    },
    update: {
      graceMinutes: 5,
      requiredHoursMin: 480,
      timezone: 'Asia/Islamabad',
    },
  });

  const pass = process.env.SEED_ADMIN_PASSWORD ?? 'changeme12345';
  const passwordHash = await bcrypt.hash(pass, 12);

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@pulsetrack.local';
  let admin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!admin) {
    admin = await prisma.user.create({
      data: { email: adminEmail, name: 'Demo Admin', passwordHash, role: 'ADMIN', points: 0 },
    });
    console.log(`Created admin ${adminEmail} / ${pass}`);
  }

  const members = [];
  for (let i = 0; i < MEMBER_NAMES.length; i += 1) {
    const email = i === 0
      ? (process.env.SEED_MEMBER_EMAIL ?? 'member@pulsetrack.local')
      : `member${i + 1}@pulsetrack.local`;
    let u = await prisma.user.findUnique({ where: { email } });
    if (!u) {
      u = await prisma.user.create({
        data: {
          email,
          name: MEMBER_NAMES[i],
          passwordHash,
          role: 'MEMBER',
          department: i % 2 === 0 ? 'Operations' : 'Support',
          points: 50 + i * 15,
          streakDays: i % 4,
          expectedStartMin: 540,
          expectedEndMin: 1020,
          timezone: 'Asia/Islamabad',
        },
      });
    }
    members.push(u);
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  for (let d = 0; d < 14; d += 1) {
    const day = new Date(today);
    day.setUTCDate(day.getUTCDate() - d);

    for (let i = 0; i < members.length; i += 1) {
      const m = members[i];
      const pattern = i % 4;
      let status = AttendanceStatus.PRESENT;
      let lateMinutes = 0;
      let totalHours = 8;

      if (pattern === 1 && d % 3 === 0) {
        status = AttendanceStatus.LATE;
        lateMinutes = 12 + d;
        totalHours = 7.5;
      } else if (pattern === 2 && d % 5 === 0) {
        status = AttendanceStatus.ABSENT;
        totalHours = 0;
      } else if (pattern === 3 && d === 2) {
        status = AttendanceStatus.ON_LEAVE;
        totalHours = 0;
      }

      await prisma.attendanceRecord.upsert({
        where: { userId_date: { userId: m.id, date: day } },
        create: {
          userId: m.id,
          date: day,
          status,
          scheduledClockIn: 540,
          scheduledClockOut: 1020,
          requiredHours: 8,
          lateMinutes,
          totalHoursWorked: totalHours,
          isComplete: totalHours >= 8,
          lateNote: status === AttendanceStatus.LATE ? 'Traffic delay on commute route.' : null,
          clockInTime: status !== AttendanceStatus.ABSENT && status !== AttendanceStatus.ON_LEAVE
            ? new Date(day.getTime() + (540 + lateMinutes) * 60_000)
            : null,
        },
        update: {},
      });
    }
  }

  const pendingLeave = await prisma.leaveRequest.count({ where: { status: LeaveStatus.PENDING } });
  if (pendingLeave === 0) {
    await prisma.leaveRequest.createMany({
      data: [
        {
          userId: members[1].id,
          requestedDate: new Date(today.getTime() + 5 * 86400_000),
          type: LeaveType.VACATION,
          reason: 'Family vacation planned months ago — need 1 day off for travel.',
          status: LeaveStatus.PENDING,
        },
        {
          userId: members[3].id,
          requestedDate: today,
          type: LeaveType.EMERGENCY,
          reason: 'Medical emergency — need today off to attend urgent appointment.',
          isEmergency: true,
          status: LeaveStatus.PENDING,
        },
      ],
    });
  }

  const anomalyCount = await prisma.anomalyLog.count();
  if (anomalyCount === 0) {
    await prisma.anomalyLog.create({
      data: {
        userId: members[2].id,
        type: AnomalyType.NEW_DEVICE,
        details: { fingerprint: 'pt_demo_unknown' },
        ipAddress: '203.0.113.42',
      },
    });
  }

  console.log('Seed complete — members, attendance, leaves, anomalies');
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
