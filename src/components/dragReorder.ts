import type FloatingToc from "src/main";
import { MarkdownView, HeadingCache, Notice } from "obsidian";
import { refresh_node } from "src/main";

/**
 * 获取标题的内容范围（包括标题本身和其下的所有内容，直到下一个同级或更高级标题）
 */
function getHeadingContentRange(
    headings: HeadingCache[],
    currentIndex: number,
    fileContent: string
): { start: number; end: number; content: string } {
    const currentHeading = headings[currentIndex];
    const currentLevel = currentHeading.level;
    const startLine = currentHeading.position.start.line;

    // 查找下一个同级或更高级的标题
    let endLine = -1;
    for (let i = currentIndex + 1; i < headings.length; i++) {
        if (headings[i].level <= currentLevel) {
            endLine = headings[i].position.start.line;
            break;
        }
    }

    // 如果没有找到下一个同级标题，则到文件末尾
    const lines = fileContent.split('\n');
    if (endLine === -1) {
        endLine = lines.length;
    }

    // 获取内容
    const contentLines = lines.slice(startLine, endLine);
    const content = contentLines.join('\n');

    return {
        start: startLine,
        end: endLine,
        content: content
    };
}

/**
 * 在编辑器中移动标题内容
 */
async function moveHeadingContent(
    view: MarkdownView,
    sourceIndex: number,
    targetIndex: number,
    headings: HeadingCache[]
): Promise<boolean> {
    try {
        const editor = view.editor;
        const fileContent = editor.getValue();

        // 获取源标题的内容范围
        const sourceRange = getHeadingContentRange(headings, sourceIndex, fileContent);

        // 计算目标位置
        let targetLine: number;
        if (targetIndex < sourceIndex) {
            // 向上移动
            targetLine = headings[targetIndex].position.start.line;
        } else {
            // 向下移动
            const targetHeading = headings[targetIndex];
            const targetRange = getHeadingContentRange(headings, targetIndex, fileContent);
            targetLine = targetRange.end;
        }

        // 执行移动操作
        const lines = fileContent.split('\n');

        // 1. 提取要移动的内容
        const movedContent = lines.slice(sourceRange.start, sourceRange.end);

        // 2. 删除原位置的内容
        lines.splice(sourceRange.start, sourceRange.end - sourceRange.start);

        // 3. 调整目标位置（如果目标在源之后，需要调整索引）
        if (targetLine > sourceRange.start) {
            targetLine -= (sourceRange.end - sourceRange.start);
        }

        // 4. 在目标位置插入内容
        lines.splice(targetLine, 0, ...movedContent);

        // 5. 更新编辑器内容
        const newContent = lines.join('\n');
        editor.setValue(newContent);

        return true;
    } catch (error) {
        console.error('移动标题内容失败:', error);
        new Notice('移动标题失败');
        return false;
    }
}

/**
 * 为标题列表项添加拖拽功能
 */
export function enableDragReorder(
    plugin: FloatingToc,
    li_dom: HTMLElement,
    heading: HeadingCache,
    index: number,
    view: MarkdownView
) {
    if (!plugin.settings.enableDragReorder) {
        return;
    }

    // 设置可拖拽
    li_dom.setAttribute('draggable', 'true');
    li_dom.addClass('draggable-heading');

    // 拖拽开始
    li_dom.addEventListener('dragstart', (e: DragEvent) => {
        e.stopPropagation();
        li_dom.addClass('dragging');

        // 存储拖拽数据
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', index.toString());
        }
    });

    // 拖拽结束
    li_dom.addEventListener('dragend', (e: DragEvent) => {
        e.stopPropagation();
        li_dom.removeClass('dragging');

        // 清除所有拖拽样式
        const allItems = li_dom.parentElement?.querySelectorAll('.heading-list-item');
        allItems?.forEach(item => {
            item.removeClass('drag-over');
            item.removeClass('drag-over-top');
            item.removeClass('drag-over-bottom');
        });
    });

    // 拖拽经过
    li_dom.addEventListener('dragover', (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();

        if (li_dom.classList.contains('dragging')) {
            return;
        }

        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'move';
        }

        // 计算鼠标位置，决定插入到上方还是下方
        const rect = li_dom.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;

        if (e.clientY < midpoint) {
            li_dom.addClass('drag-over-top');
            li_dom.removeClass('drag-over-bottom');
        } else {
            li_dom.addClass('drag-over-bottom');
            li_dom.removeClass('drag-over-top');
        }
    });

    // 拖拽离开
    li_dom.addEventListener('dragleave', (e: DragEvent) => {
        e.stopPropagation();
        li_dom.removeClass('drag-over-top');
        li_dom.removeClass('drag-over-bottom');
    });

    // 放置
    li_dom.addEventListener('drop', async (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();

        li_dom.removeClass('drag-over-top');
        li_dom.removeClass('drag-over-bottom');

        if (li_dom.classList.contains('dragging')) {
            return;
        }

        const sourceIndexStr = e.dataTransfer?.getData('text/plain');
        if (!sourceIndexStr) return;

        const sourceIndex = parseInt(sourceIndexStr);
        const targetIndex = index;

        if (sourceIndex === targetIndex) {
            return;
        }

        // 计算实际的目标位置
        const rect = li_dom.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        let actualTargetIndex = targetIndex;

        if (e.clientY >= midpoint) {
            // 插入到目标下方
            actualTargetIndex = targetIndex + 1;
        }

        // 如果源在目标之前，且要插入到目标下方，需要调整
        if (sourceIndex < targetIndex && e.clientY >= midpoint) {
            actualTargetIndex = targetIndex;
        }

        // 执行移动
        const success = await moveHeadingContent(
            view,
            sourceIndex,
            actualTargetIndex > sourceIndex ? actualTargetIndex - 1 : actualTargetIndex,
            plugin.headingdata
        );

        if (success) {
            new Notice('标题已移动');

            // 强制更新元数据缓存
            const file = view.file;
            if (file) {
                // 添加更新中的视觉反馈
                const floatToc = view.contentEl.querySelector('.floating-toc');
                if (floatToc) {
                    floatToc.addClass('updating');
                }

                // 创建一个 Promise 来等待元数据缓存更新
                const waitForCacheUpdate = new Promise<void>((resolve) => {
                    const eventRef = plugin.app.metadataCache.on('changed', (changedFile) => {
                        if (changedFile.path === file.path) {
                            plugin.app.metadataCache.offref(eventRef);
                            resolve();
                        }
                    });

                    // 设置超时，防止永久等待
                    setTimeout(() => {
                        plugin.app.metadataCache.offref(eventRef);
                        resolve();
                    }, 2000);
                });

                // 等待缓存更新
                await waitForCacheUpdate;

                // 获取更新后的标题数据
                const updatedHeadings = plugin.app.metadataCache.getFileCache(file)?.headings;
                if (updatedHeadings) {
                    plugin.headingdata = updatedHeadings;

                    if (plugin.settings.ignoreHeaders) {
                        let levelsToFilter = plugin.settings.ignoreHeaders.split("\n");
                        plugin.headingdata = updatedHeadings.filter(
                            (item) => !levelsToFilter.includes(item.level.toString())
                        );
                    }
                }

                // 使用平滑更新而不是完全重建
                refresh_node(plugin, view);

                // 移除更新中的视觉反馈
                if (floatToc) {
                    setTimeout(() => {
                        floatToc.removeClass('updating');
                    }, 150);
                }
            }
        }
    });
}
