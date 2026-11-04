export function textSegments(message) {
  if(typeof message==='string') return message;
  if(!Array.isArray(message)) throw Error('unsupported message');
  if(message.some(m=>m?.type!=='text')) throw Error('only text supported in MVP');
  return message.map(m=>String(m.data?.text??'')).join('');
}
export function messageEvent({selfId,messageId,conversationId,senderId,senderName,group,content,mentionedSelf=false}) {
  const id=Number(messageId),user=Number(senderId),groupId=Number(conversationId);
  return {
    post_type:'message',message_type:group?'group':'private',sub_type:group?'normal':'friend',
    message_id:id,user_id:user,...(group?{group_id:groupId}:{}),
    message:[...(mentionedSelf?[{type:'at',data:{qq:String(selfId)}}]:[]),{type:'text',data:{text:content}}],
    raw_message:content,message_format:'array',font:0,
    sender:{user_id:user,nickname:senderName??'未知用户',...(group?{card:senderName??'',role:'member'}:{})}
  };
}
