/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { diag } from '@opentelemetry/api';
import * as core from '@opentelemetry/core';
import { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import * as http from 'http';
import * as assert from 'assert';
import * as sinon from 'sinon';
import { PassThrough, Stream } from 'stream';
import * as zlib from 'zlib';
import {
  OTLPTraceExporter,
  OTLPExporterNodeConfigBase,
  CompressionAlgorithm,
} from '../../src/platform/node';
import * as otlpTypes from '../../src/types';
import { MockedResponse } from './nodeHelpers';

import {
  ensureExportTraceServiceRequestIsSet,
  ensureSpanIsCorrect,
  mockedReadableSpan,
} from '../helper';

let fakeRequest: PassThrough;

const address = 'localhost:1501';

describe('OTLPTraceExporter - node with json over http', () => {
  let collectorExporter: OTLPTraceExporter;
  let collectorExporterConfig: OTLPExporterNodeConfigBase;
  let stubRequest: sinon.SinonStub;
  let spySetHeader: sinon.SinonSpy;
  let spans: ReadableSpan[];

  afterEach(() => {
    fakeRequest = new Stream.PassThrough();
    sinon.restore();
  });

  describe('instance', () => {
    it('should warn about metadata when using json', () => {
      const metadata = 'foo';
      // Need to stub/spy on the underlying logger as the "diag" instance is global
      const spyLoggerWarn = sinon.stub(diag, 'warn');
      collectorExporter = new OTLPTraceExporter({
        serviceName: 'basic-service',
        metadata,
        url: address,
      } as any);
      const args = spyLoggerWarn.args[0];
      assert.strictEqual(args[0], 'Metadata cannot be set when using http');
    });
  });

  describe('when configuring via environment', () => {
    const envSource = process.env;
    it('should use url defined in env', () => {
      envSource.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://foo.bar/v1/traces';
      const collectorExporter = new OTLPTraceExporter();
      assert.strictEqual(
        collectorExporter.url,
        envSource.OTEL_EXPORTER_OTLP_ENDPOINT
      );
      envSource.OTEL_EXPORTER_OTLP_ENDPOINT = '';
    });
    it('should use url defined in env and append version and signal when not present', () => {
      envSource.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://foo.bar';
      const collectorExporter = new OTLPTraceExporter();
      assert.strictEqual(
        collectorExporter.url,
        `${envSource.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`
      );
      envSource.OTEL_EXPORTER_OTLP_ENDPOINT = '';
    });
    it('should override global exporter url with signal url defined in env', () => {
      envSource.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://foo.bar';
      envSource.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = 'http://foo.traces';
      const collectorExporter = new OTLPTraceExporter();
      assert.strictEqual(
        collectorExporter.url,
        envSource.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
      );
      envSource.OTEL_EXPORTER_OTLP_ENDPOINT = '';
      envSource.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = '';
    });
    it('should use headers defined via env', () => {
      envSource.OTEL_EXPORTER_OTLP_HEADERS = 'foo=bar';
      const collectorExporter = new OTLPTraceExporter();
      assert.strictEqual(collectorExporter.headers.foo, 'bar');
      envSource.OTEL_EXPORTER_OTLP_HEADERS = '';
    });
    it('should override global headers config with signal headers defined via env', () => {
      envSource.OTEL_EXPORTER_OTLP_HEADERS = 'foo=bar,bar=foo';
      envSource.OTEL_EXPORTER_OTLP_TRACES_HEADERS = 'foo=boo';
      const collectorExporter = new OTLPTraceExporter();
      assert.strictEqual(collectorExporter.headers.foo, 'boo');
      assert.strictEqual(collectorExporter.headers.bar, 'foo');
      envSource.OTEL_EXPORTER_OTLP_TRACES_HEADERS = '';
      envSource.OTEL_EXPORTER_OTLP_HEADERS = '';
    });
  });

  describe('export', () => {
    beforeEach(() => {
      stubRequest = sinon.stub(http, 'request').returns(fakeRequest as any);
      collectorExporterConfig = {
        headers: {
          foo: 'bar',
        },
        hostname: 'foo',
        attributes: {},
        url: 'http://foo.bar.com',
        keepAlive: true,
        httpAgentOptions: { keepAliveMsecs: 2000 },
      };
      collectorExporter = new OTLPTraceExporter(collectorExporterConfig);
      spans = [];
      spans.push(Object.assign({}, mockedReadableSpan));
    });

    it('should open the connection', done => {
      collectorExporter.export(spans, () => { });

      setTimeout(() => {
        const args = stubRequest.args[0];
        const options = args[0];

        assert.strictEqual(options.hostname, 'foo.bar.com');
        assert.strictEqual(options.method, 'POST');
        assert.strictEqual(options.path, '/');
        done();
      });
    });

    it('should set custom headers', done => {
      collectorExporter.export(spans, () => { });

      setTimeout(() => {
        const args = stubRequest.args[0];
        const options = args[0];
        assert.strictEqual(options.headers['foo'], 'bar');
        done();
      });
    });

    it('should not have Content-Encoding header', done => {
      collectorExporter.export(spans, () => { });

      setTimeout(() => {
        const args = stubRequest.args[0];
        const options = args[0];
        assert.strictEqual(options.headers['Content-Encoding'], undefined);
        done();
      });
    });

    it('should have keep alive and keepAliveMsecs option set', done => {
      collectorExporter.export(spans, () => { });

      setTimeout(() => {
        const args = stubRequest.args[0];
        const options = args[0];
        const agent = options.agent;
        assert.strictEqual(agent.keepAlive, true);
        assert.strictEqual(agent.options.keepAliveMsecs, 2000);
        done();
      });
    });

    it('different http export requests should use the same agent', done => {
      collectorExporter.export(spans, () => { });
      collectorExporter.export(spans, () => { });

      setTimeout(() => {
        const [firstExportAgent, secondExportAgent] = stubRequest.args.map(
          a => a[0].agent
        );
        assert.strictEqual(firstExportAgent, secondExportAgent);
        done();
      });
    });

    it('should successfully send the spans', done => {
      let buff = Buffer.from('');

      fakeRequest.on('end', () => {
        const responseBody = buff.toString();

        const json = JSON.parse(
          responseBody
        ) as otlpTypes.opentelemetryProto.collector.trace.v1.ExportTraceServiceRequest;
        const span1 =
          json.resourceSpans[0].instrumentationLibrarySpans[0].spans[0];
        assert.ok(typeof span1 !== 'undefined', "span doesn't exist");
        if (span1) {
          ensureSpanIsCorrect(span1);
        }

        ensureExportTraceServiceRequestIsSet(json);

        done();
      });

      fakeRequest.on('data', chunk => {
        buff = Buffer.concat([buff, chunk]);
      });

      collectorExporter.export(spans, () => { });
    });

    it('should log the successful message', done => {
      // Need to stub/spy on the underlying logger as the "diag" instance is global
      const stubLoggerError = sinon.stub(diag, 'error');
      const responseSpy = sinon.spy();
      collectorExporter.export(spans, responseSpy);

      setTimeout(() => {
        const mockRes = new MockedResponse(200);
        const args = stubRequest.args[0];
        const callback = args[1];
        callback(mockRes);
        mockRes.send('success');
        setTimeout(() => {
          assert.strictEqual(stubLoggerError.args.length, 0);
          assert.strictEqual(
            responseSpy.args[0][0].code,
            core.ExportResultCode.SUCCESS
          );
          done();
        });
      });
    });

    it('should log the error message', done => {
      const responseSpy = sinon.spy();
      collectorExporter.export(spans, responseSpy);

      setTimeout(() => {
        const mockResError = new MockedResponse(400);
        const args = stubRequest.args[0];
        const callback = args[1];
        callback(mockResError);
        mockResError.send('failed');
        setTimeout(() => {
          const result = responseSpy.args[0][0] as core.ExportResult;
          assert.strictEqual(result.code, core.ExportResultCode.FAILED);
          const error = result.error as otlpTypes.OTLPExporterError;
          assert.ok(error !== undefined);
          assert.strictEqual(error.code, 400);
          assert.strictEqual(error.data, 'failed');
          done();
        });
      });
    });
  });

  describe('export - with compression', () => {
    beforeEach(() => {
      stubRequest = sinon.stub(http, 'request').returns(fakeRequest as any);
      spySetHeader = sinon.spy();
      (fakeRequest as any).setHeader = spySetHeader;
      collectorExporterConfig = {
        headers: {
          foo: 'bar',
        },
        hostname: 'foo',
        attributes: {},
        url: 'http://foo.bar.com',
        keepAlive: true,
        compression: CompressionAlgorithm.GZIP,
        httpAgentOptions: { keepAliveMsecs: 2000 },
      };
      collectorExporter = new OTLPTraceExporter(collectorExporterConfig);
      spans = [];
      spans.push(Object.assign({}, mockedReadableSpan));
    });

    it('should successfully send the spans', done => {
      collectorExporter.export(spans, () => { });
      let buff = Buffer.from('');

      fakeRequest.on('end', () => {
        const responseBody = zlib.gunzipSync(buff).toString();

        const json = JSON.parse(
          responseBody
        ) as otlpTypes.opentelemetryProto.collector.trace.v1.ExportTraceServiceRequest;
        const span1 =
          json.resourceSpans[0].instrumentationLibrarySpans[0].spans[0];
        assert.ok(typeof span1 !== 'undefined', "span doesn't exist");
        if (span1) {
          ensureSpanIsCorrect(span1);
        }

        ensureExportTraceServiceRequestIsSet(json);
        assert.ok(spySetHeader.calledWith('Content-Encoding', 'gzip'));

        done();
      });

      fakeRequest.on('data', chunk => {
        buff = Buffer.concat([buff, chunk]);
      });
    });

  });

  describe('OTLPTraceExporter - node (getDefaultUrl)', () => {
    it('should default to localhost', done => {
      const collectorExporter = new OTLPTraceExporter();
      setTimeout(() => {
        assert.strictEqual(
          collectorExporter['url'],
          'http://localhost:55681/v1/traces'
        );
        done();
      });
    });

    it('should keep the URL if included', done => {
      const url = 'http://foo.bar.com';
      const collectorExporter = new OTLPTraceExporter({ url });
      setTimeout(() => {
        assert.strictEqual(collectorExporter['url'], url);
        done();
      });
    });
  });
});
