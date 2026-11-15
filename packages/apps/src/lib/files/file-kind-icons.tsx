import type { ReactNode } from "react";
import {
  Folder,
  FileText,
  FileImage,
  FileVideo,
  FileAudio,
  FileArchive,
  File as FileIcon,
} from "lucide-react";
import type { FileKind } from "@/lib/files/drive-models";

export const kindIcon: Record<FileKind, ReactNode> = {
  folder: <Folder className="size-3" />,
  doc: <FileText className="size-3" />,
  image: <FileImage className="size-3" />,
  video: <FileVideo className="size-3" />,
  audio: <FileAudio className="size-3" />,
  archive: <FileArchive className="size-3" />,
  file: <FileIcon className="size-3" />,
};

export const kindIconLg: Record<FileKind, ReactNode> = {
  folder: <Folder className="size-10" />,
  doc: <FileText className="size-10" />,
  image: <FileImage className="size-10" />,
  video: <FileVideo className="size-10" />,
  audio: <FileAudio className="size-10" />,
  archive: <FileArchive className="size-10" />,
  file: <FileIcon className="size-10" />,
};
