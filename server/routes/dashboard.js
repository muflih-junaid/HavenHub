import { Router } from 'express';
import DisasterReport from '../models/DisasterReport.js';
import AssistanceRequest from '../models/AssistanceRequest.js';
import User from '../models/User.js';
import Resource from '../models/Resource.js';
import { authenticate, authorizeRoles } from '../middleware/auth.js';
import { authError as httpError } from '../utils/auth.js';

const router = Router();
// A shared MVP threshold in each resource's own whole units, including empty stock.
const lowStockThreshold = 10;
const listLimit = 5;

router.get('/summary', authenticate, authorizeRoles('admin'), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (Object.keys(req.query).length) throw httpError(400, 'Dashboard summary does not accept query parameters');

  const [totalDisasters, pendingDisasters, verifiedDisasters, pendingRequests, activeRequests,
    completedRequests, totalVolunteers, totalResourceTypes, lowStockResources, recentDisasters, urgentPendingRequests] = await Promise.all([
    DisasterReport.countDocuments({}),
    DisasterReport.countDocuments({ status: 'pending' }),
    DisasterReport.countDocuments({ status: 'verified' }),
    AssistanceRequest.countDocuments({ status: 'pending' }),
    AssistanceRequest.countDocuments({ status: { $in: ['assigned', 'in_progress'] } }),
    AssistanceRequest.countDocuments({ status: 'completed' }),
    User.countDocuments({ role: 'volunteer' }),
    Resource.countDocuments({}),
    Resource.countDocuments({ active: true, quantityAvailable: { $lte: lowStockThreshold } }),
    DisasterReport.find({}).select('title disasterType severity status createdAt')
      .sort({ createdAt: -1, _id: -1 }).limit(listLimit).lean(),
    AssistanceRequest.find({ status: 'pending', urgency: { $in: ['high', 'critical'] } })
      .select('assistanceType urgency status createdAt')
      // Among these two urgency values, ascending order puts critical before high.
      .sort({ urgency: 1, createdAt: 1, _id: 1 }).limit(listLimit).lean(),
  ]);

  res.json({
    metrics: {
      disasters: { total: totalDisasters, pending: pendingDisasters, verified: verifiedDisasters },
      requests: { pending: pendingRequests, active: activeRequests, completed: completedRequests },
      volunteers: { total: totalVolunteers },
      resources: { totalTypes: totalResourceTypes, lowStock: lowStockResources },
    },
    recentDisasters: recentDisasters.map((report) => ({
      id: report._id.toString(), title: report.title, disasterType: report.disasterType,
      severity: report.severity, status: report.status, createdAt: report.createdAt,
    })),
    urgentPendingRequests: urgentPendingRequests.map((request) => ({
      id: request._id.toString(), assistanceType: request.assistanceType,
      urgency: request.urgency, status: request.status, createdAt: request.createdAt,
    })),
    lowStockThreshold,
    generatedAt: new Date().toISOString(),
  });
});

export default router;
