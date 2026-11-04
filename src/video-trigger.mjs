// Only explicitly requested, authorized video analyses are eligible.
// A shared card by itself NEVER triggers playback.
import {sharedWorkDetails} from './shared-work.mjs';

const REQUEST=/(?:分析|总结|解读|讲解|点评|评价|看看|看一下|说说|帮我看|给我看).{0,14}(?:视频|作品|这条|这个)|(?:视频|作品).{0,14}(?:分析|总结|解读|讲解|点评|评价|看看)/u;
const SIMPLE_REQUEST=/(?:^|[\s，。！？])(?:请|帮我|给我|麻烦)?看(?:下|一下)?(?:一下)?(?:我发的|刚发的|刚才的|这个|这条|这段|下这个|一下这个|这)?(?:视频|作品)/u;
const MESSAGE_ID=/^msg:[a-f0-9]{64}$/;
const MEMBER_ID=/^member:[a-f0-9]{64}$/;

export function selectRequestedVideo(messages,requestIndex,{group=false,lookback=8}={}){
  if(!Array.isArray(messages)||!Number.isInteger(requestIndex)||requestIndex<0||requestIndex>=messages.length)
    return null;
  const request=messages[requestIndex];
  if(!request||request.sender!=='incoming'||request.unsupported===true||
     request.nonReplyableNotice===true||!MESSAGE_ID.test(request.id??'')||
     typeof request.text!=='string'||!(REQUEST.test(request.text)||SIMPLE_REQUEST.test(request.text)))return null;
  if(group&&(request.mentionedSelf!==true||!MEMBER_ID.test(request.memberId??'')))return null;
  for(let i=requestIndex;i>=Math.max(0,requestIndex-lookback);i--){
    const candidate=messages[i];
    if(!candidate)continue;
    if(candidate.sender==='outgoing')break; // do not attach to another turn
    if(candidate.sender!=='incoming'||candidate.unsupported||candidate.nonReplyableNotice)continue;
    if(!MESSAGE_ID.test(candidate.id??''))continue;
    if(group&&candidate.memberId!==request.memberId)continue;
    const work=sharedWorkDetails(candidate);
    if(work?.type==='video'&&work.identityConflict!==true)
      return {request,card:candidate,work};
  }
  return null;
}

export function formatSampleEvidence(result){
  const o=result?.observation;
  if(!o||result.frames?.length!==3||o.frameCount!==3||
    !Number.isFinite(o.playbackProgressSeconds)||o.playbackProgressSeconds<0.2)
    throw Error('视频分时画面没有可核验的播放证据');
  return [
    '[抖音视频实际分时采样]',
    '作品链接：'+result.url,
    '采样帧数：3 张 JPEG（按时间先后顺序）',
    '实际播放进度：'+o.playbackProgressSeconds.toFixed(2)+' 秒',
    '采样范围：部分视频画面，无音轨、无对白转写，不代表看完整条。',
    '请仅依据所附画面回答；无法从画面确认的声音、情节或结局应说明未知。'
  ].join('\n');
}
