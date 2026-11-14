// Entries whose Zury reviews were overwritten to "pending" by Fountain sync: decide them again from their reviews.
require('dotenv').config();
require('../src/config/database');
const R = require('path').join(__dirname, '..') + '/';const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
const {decide}=require(R+'src/services/reviewService');
(async()=>{const list=await p.submission.findMany({where:{status:{in:['pending','validated','invalid','under_review']},reviews:{some:{decision:{in:['accept','reject']}}}},include:{reviews:{orderBy:{createdAt:'asc'}}}});
for(const s of list){const st=await p.contestSettings.findFirst({where:{contestId:s.contestId}});const n=decide(s.reviews,st);
if(n.status===s.status)continue;await p.submission.update({where:{id:s.id},data:{status:n.status,score:n.score,history:{create:{actorId:null,action:'reviewed',previousValue:s.status,newValue:n.status,note:'restored'}}}});console.log(s.title,s.status,'->',n.status);}
await p.$disconnect()})();
