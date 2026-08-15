import { describe, it, expect, vi } from 'vitest';
import { waitForSubmissionResult } from '../../src/panel-flow.mjs';

/** 构造最小 page 桩：evaluate 返回正文，url 返回当前地址 */
function makePage({ text, url }) {
  return {
    evaluate: vi.fn().mockResolvedValue(text),
    url: vi.fn().mockReturnValue(url),
  };
}

describe('waitForSubmissionResult', () => {
  it('首次读取即命中成功信号时提前返回，不再继续轮询', async () => {
    const page = makePage({
      text: '手続きが完了しました',
      url: 'https://secure.xserver.ne.jp/xapanel/xvps/server/freevps/extend/result',
    });
    const { evaluation, pageText } = await waitForSubmissionResult(page, {
      timeoutMs: 2000,
      intervalMs: 400,
    });
    expect(evaluation.status).toBe('success');
    expect(pageText).toBe('手続きが完了しました');
    // 成功立即返回：正文只读取一次
    expect(page.evaluate).toHaveBeenCalledTimes(1);
  });

  it('始终停留在 conf 页（retry）时轮询至超时，返回最后一次评估', async () => {
    const page = makePage({
      text: '認証に失敗しました',
      url: 'https://secure.xserver.ne.jp/xapanel/xvps/server/freevps/extend/conf',
    });
    const { evaluation } = await waitForSubmissionResult(page, {
      timeoutMs: 60,
      intervalMs: 10,
    });
    expect(evaluation.status).toBe('retry');
    // 未命中成功信号：应轮询多次（远多于 1 次）
    expect(page.evaluate.mock.calls.length).toBeGreaterThan(1);
  });

  it('失败标识但未命中成功信号时同样等待至超时，避免过早误判', async () => {
    const page = makePage({
      text: 'クレジットカードを登録してください',
      url: 'https://secure.xserver.ne.jp/xapanel/xvps/server/freevps/extend/result',
    });
    const { evaluation } = await waitForSubmissionResult(page, {
      timeoutMs: 60,
      intervalMs: 10,
    });
    expect(evaluation.status).toBe('fail');
    expect(page.evaluate.mock.calls.length).toBeGreaterThan(1);
  });

  it('无 logger 时不报错（默认 NOOP_LOGGER）', async () => {
    const page = makePage({
      text: '更新が完了しました',
      url: 'https://secure.xserver.ne.jp/xapanel/xvps/server/freevps/extend/result',
    });
    await expect(waitForSubmissionResult(page, { timeoutMs: 50, intervalMs: 10 }))
      .resolves.toMatchObject({ evaluation: expect.objectContaining({ status: 'success' }) });
  });

  it('未识别成功信号时输出页面正文诊断（debug），便于定位成功文案', async () => {
    // 模拟本次事故场景：提交后官方跳回 xvps/index 列表页，正文无已知成功关键词
    const page = makePage({
      text: '契約管理\n引き続き無料VPSの利用を継続する\nホーム',
      url: 'https://secure.xserver.ne.jp/xapanel/xvps/index',
    });
    const logger = { debug: vi.fn() };
    const { evaluation } = await waitForSubmissionResult(page, {
      timeoutMs: 60,
      intervalMs: 10,
      logger,
    });
    expect(evaluation.status).not.toBe('success');
    const diagLines = logger.debug.mock.calls
      .map((call) => call[0])
      .filter((line) => line.includes('[提交结果诊断]'));
    // 诊断仅在轮询结束后输出一次
    expect(diagLines).toHaveLength(1);
    expect(diagLines[0]).toContain('URL: https://secure.xserver.ne.jp/xapanel/xvps/index');
    // 正文应归一化空白后输出（换行折叠为空格）
    expect(diagLines[0]).toContain('契約管理 引き続き無料VPSの利用を継続する ホーム');
  });

  it('命中成功信号时不输出正文诊断（仅输出命中日志）', async () => {
    const page = makePage({
      text: '手続きが完了しました',
      url: 'https://secure.xserver.ne.jp/xapanel/xvps/server/freevps/extend/result',
    });
    const logger = { debug: vi.fn() };
    await waitForSubmissionResult(page, { timeoutMs: 50, intervalMs: 10, logger });
    const diagLines = logger.debug.mock.calls
      .map((call) => call[0])
      .filter((line) => line.includes('[提交结果诊断]'));
    expect(diagLines).toHaveLength(0);
  });
});
