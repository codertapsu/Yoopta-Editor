import { useCallback } from 'react';
import { type PluginElementRenderProps, useYooptaPluginOptions } from '@yoopta/editor';
import { Blocks, Elements, useYooptaEditor } from '@yoopta/editor';
import {
  type ImageElement as ImageElementType,
  type ImagePluginOptions,
  useImageDelete,
  useImagePreview,
  useImageUpload,
} from '@yoopta/image';
import { Editor, Element } from 'slate';

import { ImagePlaceholder } from './image-placeholder';
import { ImageRender } from './image-render';
import type { ImageElementProps } from '../../types';

export const ImageElement = ({
  element,
  attributes,
  children,
  blockId,
}: PluginElementRenderProps) => {
  const editor = useYooptaEditor();
  const pluginOptions = useYooptaPluginOptions<ImagePluginOptions>('Image');
  const { upload: uploadImageToStorage, progress, loading } = useImageUpload(pluginOptions.upload!);
  const { deleteImage: deleteImageFromStorage } = useImageDelete(pluginOptions.delete!);
  const { preview, generatePreview, clearPreview } = useImagePreview();

  const updateElement = useCallback(
    (props: Partial<ImageElementProps>) => {
      Elements.updateElement(editor, {
        blockId,
        type: 'image',
        props: {
          ...element.props,
          ...props,
        },
      });
    },
    [editor, blockId, element.props],
  );

  const deleteImage = useCallback(async () => {
    await deleteImageFromStorage(element as ImageElementType);
    const slate = Blocks.getBlockSlate(editor, { id: blockId });
    if (!slate) return;

    const elementPath = Elements.getElementPath(editor, { blockId, element });
    if (!elementPath) return;

    const parentEntry = elementPath ? Editor.parent(slate, elementPath) : undefined;
    if (parentEntry && Element.isElement(parentEntry[0]) && !Editor.isEditor(parentEntry[0])) {
      Elements.deleteElement(editor, {
        blockId,
        type: 'image',
        path: elementPath,
      });
      return;
    }

    Blocks.deleteBlock(editor, { blockId, focus: true });
  }, [editor, blockId, element, deleteImageFromStorage]);

  const replaceImage = useCallback(() => {
    Elements.updateElement(editor, {
      blockId,
      type: 'image',
      props: {
        ...element.props,
        src: null,
        alt: null,
      },
    });
  }, [editor, blockId, element.props]);

  const onUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      generatePreview(file);
      const result = await uploadImageToStorage(file);
      updateElement({
        id: result.id || (result as any).fileId,
        src: result.url,
        alt: file.name,
        sizes: { width: result.width!, height: result.height! },
      });
      clearPreview();
      // File picker steals browser focus and clears the Slate selection.
      // Re-focus the block so useSelected() returns true and the toolbar shows immediately.
      editor.focusBlock(blockId, { waitExecution: false });
    },
    [uploadImageToStorage, updateElement, generatePreview, clearPreview, editor, blockId],
  );

  if (!element.props.src) {
    if (editor.readOnly) {
      return null;
    }

    return (
      <ImagePlaceholder
        onUpload={onUpload}
        preview={preview}
        progress={progress}
        loading={loading}
        // Insert-by-URL is real work, so it gets a real handler; this used to
        // be a no-op behind a permanently disabled tab, which silently ate the
        // URL the user typed. Sizes are deliberately left unset — the renderer
        // omits zero width/height attributes, so the image lays out at its
        // intrinsic size and the user can drag from there.
        onInsertUrl={(url: string) => {
          const trimmed = url.trim();
          if (!trimmed) {
            return;
          }

          updateElement({ src: trimmed, alt: null });
        }}
        // onInsertFromUnsplash / onInsertFromAI are intentionally NOT passed.
        // Both need a service this theme has no access to (an Unsplash API key,
        // an image-generation backend), so their tabs do not render at all
        // rather than rendering disabled. A host that can provide them can pass
        // the handlers and the tabs appear.
        attributes={attributes}>
        {children}
      </ImagePlaceholder>
    );
  }

  return (
    <ImageRender
      blockId={blockId}
      elementId={element.id}
      onUpdate={updateElement}
      onDelete={deleteImage}
      attributes={attributes}
      onReplace={replaceImage}
      elementProps={element.props}
      pluginOptions={pluginOptions}>
      {children}
    </ImageRender>
  );
};
