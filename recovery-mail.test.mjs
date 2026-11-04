import {test} from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import addressparser from 'nodemailer/lib/addressparser/index.js';
import {createRecoveryMailer} from './recovery-mail.mjs';

test('nested recipient comments cannot redirect a recovery email (GHSA-8c8m-p3m8-cjg8)',()=>{
  const result=addressparser('Victim (x(y) <attacker@evil.invalid>) <account@victim.invalid>');
  assert.deepEqual(result.map(item=>item.address),['account@victim.invalid']);
});

test('recovery mail keeps the configured sender and intended recipient without network delivery',async()=>{
  const original=nodemailer.createTransport;
  let configured;
  nodemailer.createTransport=options=>{
    configured=options;
    return original({streamTransport:true,buffer:true,newline:'unix'});
  };
  try{
    const send=await createRecoveryMailer({SMTP_HOST:'smtp.invalid',SMTP_USER:'test-user',SMTP_PASSWORD:'test-only',SMTP_FROM:'recovery@olyvex.invalid',SMTP_PORT:'587'});
    const result=await send({to:'account@victim.invalid',subject:'Recovery test',text:'Test only; no usable recovery token.'});
    assert.deepEqual(result.envelope.to,['account@victim.invalid']);
    assert.equal(result.envelope.from,'recovery@olyvex.invalid');
    assert.equal(configured.requireTLS,true);
    assert.equal(configured.tls.rejectUnauthorized,true);
    assert.equal(configured.disableFileAccess,true);
    assert.equal(configured.disableUrlAccess,true);
  }finally{nodemailer.createTransport=original;}
});
